import type { Receipt } from "@app/arkiv";
import type { MandateClient } from "@app/mandates";
import { checkLive, decodeRequest, fromHex, verifyTag } from "@app/shared";
import type { HederaIds } from "@app/x402";
import { and, count, eq, gt, gte } from "drizzle-orm";
import { keccak256, type LocalAccount, toHex } from "viem";
import { chatStore } from "../chats/store";
import type { Db } from "../db/client";
import { chats, merchants, payRequests, type User } from "../db/schema";
import { demoCapsAllow } from "../hiring/caps";
import { HireError } from "../hiring/errors";
import { demoLimitFor, LIMIT_TERMS, liveLimit, NeedsLimit } from "../hiring/limits";
import { PayError } from "../hiring/pay";
import type { OwnWallet } from "../hiring/service";
import { liveKeyFor, worldVerified } from "./merchants";
import { payMerchant } from "./settle";

export const PAID_IN_PERSON = "Paid in person"; // the payer's chat that holds these limits
export const DEMO_PAYS_A_DAY = 20;
/** The most a demo account pays a shop at once (₹500, at testnet scale): the demo wallet is shared. */
export const DEMO_MAX_UNITS = 500n;

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
  onPaid?: (receipt: Receipt) => void; // for the public record (Arkiv)
}) {
  const facilitatorUrl = process.env.FACILITATOR_URL ?? "http://localhost:8790";
  // A live code is good for 3 s (a photo can't keep up), but a person taps Pay later than
  // that. So a payer whose camera confirmed the shop's live screen keeps that confirmation
  // for this request for a while: request id + payer → until (ms).
  const liveSeen = new Map<string, number>();
  const LIVE_HOLD_MS = 120_000;
  const seenLive = (requestId: string, userId: string) =>
    (liveSeen.get(`${requestId}:${userId}`) ?? 0) > Date.now();

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
      if (units > DEMO_MAX_UNITS)
        throw new HireError(
          "Demo accounts pay shops up to ₹500 at a time. Sign in with a passkey to pay more from your own wallet.",
        );
      const blocked = await demoCapsAllow(d.db, user.id, units, d.demo.caps);
      if (blocked) throw new HireError(blocked);
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
    const live = !!view.live?.ok || seenLive(row.r.id, user.id);
    // A scanned QR pays only once its live layer proved it's the shop's screen right now: a
    // sticker or a screenshot never does. (A chirp is heard live; it's paid once and expires.)
    if (o.how === "qr" && !live)
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
    if (!(await claimRequest(d.db, row.r.id)))
      throw new HireError("This request has expired or is already being paid: ask for a new one.");
    try {
      const payTx = await payMerchant({
        ...d,
        mandateId: limit.mandateId,
        ownerAccount: limit.ownerAccount,
        facilitatorUrl,
        payTo: row.m.account,
        payee,
        units,
      });
      const done = {
        status: "paid" as const,
        payTx,
        paidAt: new Date(),
        how: o.how,
        live: o.how === "qr" ? live : (view.live?.ok ?? null),
      };
      await d.db.update(payRequests).set(done).where(eq(payRequests.id, row.r.id));
      d.onPaid?.({
        job: keccak256(toHex(row.r.frameHex)), // the request itself
        task: `shop-${row.r.id.slice(0, 8)}`,
        mandateId: limit.mandateId.toString(),
        payer: limit.ownerAccount,
        payTo: row.m.account,
        amountUnits: units.toString(),
        hederaTx: payTx,
      });
      return { ...view, status: "paid", payTx, chatId: chat.id };
    } catch (err) {
      await d.db.update(payRequests).set({ status: "open" }).where(eq(payRequests.id, row.r.id));
      throw new HireError(
        `Couldn't pay ${row.m.name} (${err instanceof PayError ? err.message : "payment failed"}). Nothing was charged.`,
      );
    }
  }

  return {
    /** Who and how much; a live screen confirmed for `userId` is remembered for their Pay. */
    async check(frameHex: string, live?: string, userId?: string) {
      const { row, view } = await check(frameHex, live);
      if (userId && view.live?.ok) {
        if (liveSeen.size > 5000)
          for (const [k, until] of liveSeen) if (until < Date.now()) liveSeen.delete(k);
        liveSeen.set(`${row.r.id}:${userId}`, Date.now() + LIVE_HOLD_MS);
      }
      return view;
    },
    pay,
    payerChat,
  };
}

/**
 * Claims a request for one payment: only while it's open and before it expires (making the
 * payer's limit can take a while: a payment never lands after the shop's screen says expired),
 * and only once, so two phones can't both pay it. False if it can't be claimed.
 */
export async function claimRequest(db: Db, id: string, now = new Date()) {
  const [claimed] = await db
    .update(payRequests)
    .set({ status: "paying" })
    .where(
      and(eq(payRequests.id, id), eq(payRequests.status, "open"), gt(payRequests.expiresAt, now)),
    )
    .returning({ id: payRequests.id });
  return !!claimed;
}
