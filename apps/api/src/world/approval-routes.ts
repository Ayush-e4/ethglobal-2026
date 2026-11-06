import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { currentUser } from "../auth/current";
import { chatStore } from "../chats/store";
import type { Db } from "../db/client";
import { quotes } from "../db/schema";
import { spendRef } from "./checkpoint";
import { checkView as view, type WorldCheck, type WorldChecks } from "./checks";

const Start = z.object({ quoteKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });

/**
 * Starts (or finds the waiting) World ID approval of a quote's agent and fee in one of the
 * user's chats: from the web card, or from Telegram. An expired quote is fine: it only says
 * which agent and fee are being approved.
 */
export async function startSpendApproval(
  db: Db,
  checks: WorldChecks,
  minFeeUnits: bigint,
  userId: string,
  chatId: string,
  quoteKey: string,
): Promise<{ check: WorldCheck; started: boolean } | { error: string; status: 404 | 409 | 502 }> {
  const chat = await chatStore(db)
    .get(userId, chatId)
    .catch(() => null);
  const [quote] = chat
    ? await db
        .select()
        .from(quotes)
        .where(and(eq(quotes.key, quoteKey), eq(quotes.chatId, chat.id)))
    : [];
  if (!chat || !quote) return { error: "No such quote in this chat", status: 404 };
  if (quote.feeUnits < minFeeUnits)
    return { error: "This booking doesn't need a World ID approval", status: 409 };
  const ref = spendRef(chat.id, quote.agentAddress, quote.feeUnits);
  const latest = await checks.latest(userId, "spend", ref);
  if (latest?.status === "waiting" && latest.expiresAt > Date.now())
    return { check: latest, started: false }; // one at a time
  const check = await checks.start(userId, "spend", ref).catch((err: Error) => err);
  if (check instanceof Error) return { error: check.message, status: 502 };
  return { check, started: true };
}

/**
 * World ID approvals of larger hires, from the chat's card. POST starts a check for the agent and
 * fee of a quote in one of your chats; GET reads how it's going. The verdict is reached on the
 * server: the hire then looks for a passed, unused, recent check for them (checkpoint.ts).
 */
export function approvalRoutes(db: Db, checks: WorldChecks | null, minFeeUnits: bigint) {
  const store = chatStore(db);
  const app = new Hono();

  app.post("/chats/:id/human-checks", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    if (!checks) return c.json({ error: "World ID isn't set up on this server" }, 503);
    const body = Start.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "give the quote's 0x key" }, 400);
    const r = await startSpendApproval(
      db,
      checks,
      minFeeUnits,
      user.id,
      c.req.param("id"),
      body.data.quoteKey,
    );
    if ("error" in r) return c.json({ error: r.error }, r.status);
    return c.json({ check: view(r.check) }, r.started ? 201 : 200);
  });

  /** The newest approval check for a quote's agent and fee in this chat (a reopened card). */
  app.get("/chats/:id/human-checks/:quoteKey", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const chat = await store.get(user.id, c.req.param("id")).catch(() => null);
    const [quote] = chat
      ? await db
          .select()
          .from(quotes)
          .where(and(eq(quotes.key, c.req.param("quoteKey")), eq(quotes.chatId, chat.id)))
      : [];
    if (!chat || !quote) return c.json({ error: "not found" }, 404);
    const ref = spendRef(chat.id, quote.agentAddress, quote.feeUnits);
    const check = await checks?.latest(user.id, "spend", ref);
    return c.json({ check: check ? view(check) : null });
  });

  app.get("/world/checks/:id", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const check = await checks?.get(c.req.param("id"), user.id);
    return check ? c.json({ check: view(check) }) : c.json({ error: "not found" }, 404);
  });

  return app;
}
