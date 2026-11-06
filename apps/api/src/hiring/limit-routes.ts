import { limitCalls } from "@app/mandates";
import { and, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import type { Address } from "viem";
import { z } from "zod";
import { currentUser } from "../auth/current";
import { chatStore } from "../chats/store";
import type { Db } from "../db/client";
import { limits, lookups, merchants, payRequests, quotes, type User } from "../db/schema";
import type { WalletChain } from "../wallet/chain";
import { ApprovalSchema, type WalletApprovals, WalletOpError } from "../wallet/ops";
import type { WalletService } from "../wallet/service";
import { LOOKUP_TERMS } from "./limits";
import type { HiringService } from "./service";

const Prepare = z.object({ payee: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });
const Run = z.object({ opId: z.uuid(), response: ApprovalSchema });

/**
 * A chat's spending limit from the user's own Face ID wallet, in two steps:
 * POST /chats/:id/limits/face-id { payee } → what the device signs (WebAuthn options), then
 * POST /chats/:id/limits { opId, response } → the wallet sets the limit on Hedera.
 * GET /chats/:id/limits lists the chat's live limits.
 * Only for an agent that quoted in this chat, on our standard terms, or a lookup agent this chat
 * asked something, on the small lookup terms; always for our concierge's key.
 */
export function limitRoutes(
  db: Db,
  hiring: HiringService,
  wallets: WalletService,
  chain: WalletChain,
  approvals: WalletApprovals,
) {
  const store = chatStore(db);
  const app = new Hono();
  const own = async (user: User) =>
    user.isDemo ? null : await wallets.get(user.id, false).catch(() => null);

  /** The chat's live limits (which agents it may pay, until when): so a card knows it's done. */
  app.get("/chats/:id/limits", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const chat = await store.get(user.id, c.req.param("id"));
    if (!chat) return c.json({ error: "not_found" }, 404);
    const rows = await db
      .select()
      .from(limits)
      .where(and(eq(limits.chatId, chat.id), gt(limits.expiresAt, new Date())));
    return c.json(
      rows.map((l) => ({
        payee: l.payee,
        budgetUnits: l.budgetUnits.toString(),
        expiresAt: l.expiresAt.toISOString(),
        demo: l.demo,
      })),
    );
  });

  app.post("/chats/:id/limits/face-id", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const chat = await store.get(user.id, c.req.param("id"));
    if (!chat) return c.json({ error: "not_found" }, 404);
    const body = Prepare.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const w = await own(user);
    if (w?.status !== "ready")
      return c.json({ error: "no_wallet", message: "Your Face ID wallet isn't ready yet." }, 409);
    const payee = body.data.payee.toLowerCase();
    const quoted = await db
      .select({ key: quotes.key })
      .from(quotes)
      .where(and(eq(quotes.chatId, chat.id), eq(quotes.agentAddress, payee)))
      .limit(1);
    const asked =
      quoted.length > 0
        ? []
        : await db
            .select({ id: lookups.id })
            .from(lookups)
            .where(and(eq(lookups.chatId, chat.id), eq(lookups.agentAddress, payee)))
            .limit(1);
    // Paying a merchant in person: the request this chat is paying, to that merchant's wallet.
    const paying =
      quoted.length > 0 || asked.length > 0
        ? []
        : await db
            .select({ id: payRequests.id })
            .from(payRequests)
            .innerJoin(merchants, eq(merchants.userId, payRequests.merchantUserId))
            .where(and(eq(payRequests.payerChatId, chat.id), eq(merchants.address, payee)))
            .limit(1);
    if (quoted.length === 0 && asked.length === 0 && paying.length === 0)
      return c.json({ error: "unknown_agent", message: "That agent hasn't quoted here." }, 409);
    const p = hiring.newLimit(payee as Address, asked.length > 0 ? LOOKUP_TERMS : undefined);
    const registry = hiring.registryAddress;
    const allowance = await chain.allowance(w.address as Address, registry);
    try {
      return c.json(
        await approvals.prepare(user.id, limitCalls(registry, p, allowance), {
          kind: "limit",
          chatId: chat.id,
          payee,
          budgetUnits: p.budget.toString(),
          expiresAt: new Date(Number(p.expiresAt) * 1000).toISOString(),
        }),
      );
    } catch (err) {
      if (err instanceof WalletOpError)
        return c.json({ error: "cannot", message: err.message }, 409);
      throw err;
    }
  });

  app.post("/chats/:id/limits", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const chat = await store.get(user.id, c.req.param("id"));
    if (!chat) return c.json({ error: "not_found" }, 404);
    const body = Run.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const meta = await approvals.meta(user.id, body.data.opId);
    if (meta?.kind !== "limit" || meta.chatId !== chat.id)
      return c.json({ error: "cannot", message: "That approval is for something else." }, 409);
    try {
      const run = await approvals.run(user.id, body.data.opId, body.data.response);
      const w = await own(user);
      if (run.mandateId === undefined || !w?.hederaId)
        return c.json({ error: "cannot", message: "The limit didn't show up on Hedera." }, 502);
      const [limit] = await db
        .insert(limits)
        .values({
          chatId: chat.id,
          mandateId: run.mandateId,
          owner: run.wallet.toLowerCase(),
          ownerAccount: w.hederaId,
          payee: meta.payee,
          budgetUnits: BigInt(meta.budgetUnits),
          demo: false,
          expiresAt: new Date(meta.expiresAt),
        })
        .returning();
      return c.json({ limitId: limit?.id, mandateId: run.mandateId.toString(), tx: run.hash }, 201);
    } catch (err) {
      if (err instanceof WalletOpError)
        return c.json({ error: "cannot", message: err.message }, 409);
      console.error(`limit for chat ${chat.id}: ${err instanceof Error ? err.message : err}`);
      return c.json({ error: "failed", message: "Hedera didn't take it. Try again." }, 502);
    }
  });
  return app;
}
