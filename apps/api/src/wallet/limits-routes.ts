import { type MandateClient, revokeCalls } from "@app/mandates";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { currentUser } from "../auth/current";
import type { Db } from "../db/client";
import { chats, type Limit, limits, quotes, type User } from "../db/schema";
import { ApprovalSchema, type WalletApprovals, WalletOpError } from "./ops";
import type { WalletService } from "./service";

const Run = z.object({ opId: z.uuid(), response: ApprovalSchema });

const statusOf = (l: Limit) =>
  l.revokedAt ? "cancelled" : l.expiresAt <= new Date() ? "expired" : "active";

/**
 * Your Face ID wallet's spending limits, and cancelling one:
 * GET /wallet/limits; POST /wallet/limits/:id/revoke/face-id → the device signs →
 * POST /wallet/limits/:id/revoke { opId, response }: the wallet revokes it on Hedera, after
 * which the concierge can't pay from it at all.
 */
export function walletLimitRoutes(
  db: Db,
  d: { wallets: WalletService; approvals: WalletApprovals; registry: MandateClient },
) {
  const app = new Hono();
  /** The user's own limit (on their wallet, not the demo wallet's), or null. */
  const own = async (user: User, id: string) => {
    if (user.isDemo || !z.uuid().safeParse(id).success) return null;
    const w = await d.wallets.get(user.id, false);
    if (!w) return null;
    const [l] = await db.select().from(limits).where(eq(limits.id, id));
    return l && !l.demo && l.owner.toLowerCase() === w.address.toLowerCase() ? l : null;
  };

  app.get("/wallet/limits", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const w = user.isDemo ? null : await d.wallets.get(user.id, false);
    if (!w) return c.json([]);
    const rows = await db
      .select({ limit: limits, chatTitle: chats.title })
      .from(limits)
      .innerJoin(chats, eq(chats.id, limits.chatId))
      .where(and(eq(chats.userId, user.id), eq(limits.demo, false)))
      .orderBy(desc(limits.createdAt));
    const mine = rows.filter((r) => r.limit.owner.toLowerCase() === w.address.toLowerCase());
    return c.json(
      await Promise.all(
        mine.map(async ({ limit: l, chatTitle }) => {
          const status = statusOf(l);
          const [q] = await db
            .select({ name: quotes.agentName })
            .from(quotes)
            .where(and(eq(quotes.chatId, l.chatId), eq(quotes.agentAddress, l.payee)))
            .limit(1);
          const left =
            status === "active" ? await d.registry.remaining(l.mandateId).catch(() => null) : null;
          return {
            id: l.id,
            chatId: l.chatId,
            chatTitle,
            agentName: q?.name ?? null,
            mandateId: l.mandateId.toString(),
            budgetUnits: l.budgetUnits.toString(),
            remainingUnits: left?.toString() ?? null,
            expiresAt: l.expiresAt.toISOString(),
            status,
          };
        }),
      ),
    );
  });

  app.post("/wallet/limits/:id/revoke/face-id", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const l = await own(user, c.req.param("id"));
    if (!l) return c.json({ error: "not_found" }, 404);
    if (statusOf(l) !== "active")
      return c.json({ error: "cannot", message: "That limit isn't active any more." }, 409);
    try {
      const calls = revokeCalls(d.registry.registry, l.mandateId);
      return c.json(await d.approvals.prepare(user.id, calls, { kind: "revoke", limitId: l.id }));
    } catch (err) {
      if (err instanceof WalletOpError)
        return c.json({ error: "cannot", message: err.message }, 409);
      throw err;
    }
  });

  app.post("/wallet/limits/:id/revoke", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const l = await own(user, c.req.param("id"));
    if (!l) return c.json({ error: "not_found" }, 404);
    const body = Run.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const meta = await d.approvals.meta(user.id, body.data.opId);
    if (meta?.kind !== "revoke" || meta.limitId !== l.id)
      return c.json({ error: "cannot", message: "That approval is for something else." }, 409);
    try {
      const run = await d.approvals.run(user.id, body.data.opId, body.data.response);
      await db.update(limits).set({ revokedAt: new Date() }).where(eq(limits.id, l.id));
      return c.json({ ok: true, tx: run.hash });
    } catch (err) {
      if (err instanceof WalletOpError)
        return c.json({ error: "cannot", message: err.message }, 409);
      console.error(`revoking limit ${l.id}: ${err instanceof Error ? err.message : err}`);
      return c.json({ error: "failed", message: "Hedera didn't take it. Try again." }, 502);
    }
  });
  return app;
}
