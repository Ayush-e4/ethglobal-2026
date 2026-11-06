import type { MandateClient } from "@app/mandates";
import { checkLive, decodeRequest, fromHex, verifyTag } from "@app/shared";
import type { HederaIds } from "@app/x402";
import { and, count, eq, gte } from "drizzle-orm";
import type { LocalAccount } from "viem";
import { chatStore } from "../chats/store";
import type { Db } from "../db/client";
import { chats, merchants, payRequests, type User } from "../db/schema";
import { HireError } from "../hiring/errors";
import { demoLimitFor, LIMIT_TERMS, liveLimit, NeedsLimit } from "../hiring/limits";
import { PayError } from "../hiring/pay";
import type { OwnWallet } from "../hiring/service";
import { liveKeyFor, worldVerified } from "./merchants";
import { payMerchant } from "./settle";

export const PAID_IN_PERSON = "Paid in person"; // the payer's chat that holds these limits
export const DEMO_PAYS_A_DAY = 20;

/**
 * The paying side: a scanned (or heard) request is checked here, never on the phone: the tag
 * proves a registered merchant made it, the live code that the screen was live, and the request
 * that it's unpaid and current. Paying moves test USDC to the merchant on Hedera within the
 * payer's limit for them (Face ID once), or from the demo wallet for demo accounts.
 */
export function inPersonPayer(d: {
  db: Db;
  registry: MandateClient;
  ids: HederaIds;
  concierge: LocalAccount;
  token: `0x${string}`;
  demo: { owner: LocalAccount; accountId: string; caps: { perUser: bigint; total: bigint } };
  ownWallet?: OwnWallet;
}) {
  const facilitatorUrl = process.env.FACILITATOR_URL ?? "http://localhost:8790";

  /** What the payer sees before paying: who, how much, and whether the screen was live. */
  async function check(frameHex: string, liveHex?: string) {
    const f = decodeRequest(fromHex(frameHex));
    if (!f.ok) throw new HireError("That isn't a Shikigami payment code.");
    const [row] = await d.db
      .select({ r: payRequests, m: merchants })
      .from(payRequests)
      .innerJoin(merchants, eq(merchants.userId, payRequests.merchantUserId))
      .where(eq(payRequests.frameHex, frameHex.toLowerCase()));
    if (
      !row ||
      row.m.account !== `0.0.${f.payee}` ||
      !(await verifyTag(f.bytes, fromHex(row.m.keyHex)))
    )
      throw new HireError("Not from a merchant on Shikigami: don't pay it.");
    const live = liveHex
      ? await checkLive(liveKeyFor(row.m.keyHex, row.r.frameHex), f.bytes, fromHex(liveHex))
      : null;
    const expired = row.r.expiresAt < new Date();
    return {
      row,
      view: {
        merchant: {
          name: row.m.name,
          account: row.m.account,
          verified: await worldVerified(d.db, row.m.userId),
        },
        inr: Number(row.r.amountUnits),
        amountUnits: row.r.amountUnits.toString(),
        expiresAt: row.r.expiresAt.toISOString(),
        status: expired && row.r.status === "open" ? "expired" : row.r.status,
        live,
      },
    };
  }

  async function payerChat(userId: string) {
    const [c] = await d.db
      .select()
      .from(chats)
      .where(and(eq(chats.userId, userId), eq(chats.title, PAID_IN_PERSON)))
      .limit(1);
    return c ?? (await chatStore(d.db).create(userId, PAID_IN_PERSON));
  }

  /** The payer's limit for this merchant: the demo wallet's, or their own (Face ID first). */
  async function payerLimit(
    user: User,
    chatId: string,
    name: string,
    payee: `0x${string}`,
    units: bigint,
  ) {
    if (user.isDemo) {
      const [n] = await d.db
        .select({ n: count() })
        .from(payRequests)
        .where(
          and(
            eq(payRequests.payerUserId, user.id),
            eq(payRequests.status, "paid"),
            gte(payRequests.paidAt, new Date(Date.now() - 86_400_000)),
          ),
        );
      if ((n?.n ?? 0) >= DEMO_PAYS_A_DAY)
        throw new HireError("This demo account's payments for today are used up.");
      return demoLimitFor(
        {
          db: d.db,
          registry: d.registry,
          owner: d.demo.owner,
          ownerAccount: d.demo.accountId,
          concierge: d.concierge.address,
          token: d.token,
        },
        chatId,
        payee,
        units,
      );
    }
    const w = await d.ownWallet?.(user.id);
    if (w?.status !== "ready" || !w.hederaId)
      throw new HireError("Your Face ID wallet is still being set up.");
    const limit = await liveLimit(d.db, d.registry, chatId, payee, units, w.address);
    if (!limit)
      throw new NeedsLimit({
        type: "limit",
        agentName: name,
        payee,
        budgetUnits: LIMIT_TERMS.budget.toString(),
        capUnits: LIMIT_TERMS.cap.toString(),
        hours: LIMIT_TERMS.hours,
        reply: "Limit approved: pay again",
      });
    return limit;
  }

  async function pay(user: User, frameHex: string, o: { live?: string; how: "qr" | "sound" }) {
    const { row, view } = await check(frameHex, o.live);
    if (row.m.userId === user.id) throw new HireError("That's your own request.");
    // A scanned QR pays only once its live layer proved it's the shop's screen right now: a
    // sticker or a screenshot never does. (A chirp is heard live; it's paid once and expires.)
    if (o.how === "qr" && !view.live?.ok)
      throw new HireError("Not confirmed as the shop's live screen: keep the camera on their QR.");
    if (view.status !== "open")
      throw new HireError(
        view.status === "paid" ? "Already paid." : "This request has expired: ask for a new one.",
      );
    const chat = await payerChat(user.id);
    const units = row.r.amountUnits;
    const payee = row.m.address as `0x${string}`;
    await d.db
      .update(payRequests)
      .set({ payerUserId: user.id, payerChatId: chat.id })
      .where(eq(payRequests.id, row.r.id));

    let limit: { mandateId: bigint; ownerAccount: string } | null;
    try {
      limit = await payerLimit(user, chat.id, row.m.name, payee, units);
    } catch (err) {
      if (err instanceof NeedsLimit || err instanceof HireError) throw err;
      // Hedera's RPC didn't answer (reading or making the limit): nothing has moved.
      console.error(`in-person limit: ${String(err).slice(0, 200)}`);
      throw new HireError("Couldn't reach Hedera to pay just now. Nothing was charged: try again.");
    }
    // Claimed first, so two phones can't both pay one request.
    const [claimed] = await d.db
      .update(payRequests)
      .set({ status: "paying" })
      .where(and(eq(payRequests.id, row.r.id), eq(payRequests.status, "open")))
      .returning();
    if (!claimed) throw new HireError("Already being paid.");
    try {
      const payTx = await payMerchant({
        ...d,
        mandateId: limit.mandateId,
        ownerAccount: limit.ownerAccount,
        facilitatorUrl,
        payTo: row.m.account,
        units,
      });
      const done = {
        status: "paid" as const,
        payTx,
        paidAt: new Date(),
        how: o.how,
        live: view.live?.ok ?? null,
      };
      await d.db.update(payRequests).set(done).where(eq(payRequests.id, row.r.id));
      return { ...view, status: "paid", payTx, chatId: chat.id };
    } catch (err) {
      await d.db.update(payRequests).set({ status: "open" }).where(eq(payRequests.id, row.r.id));
      throw new HireError(
        `Couldn't pay ${row.m.name} (${err instanceof PayError ? err.message : "payment failed"}). Nothing was charged.`,
      );
    }
  }

  return {
    check: async (frameHex: string, live?: string) => (await check(frameHex, live)).view,
    pay,
    payerChat,
  };
}
