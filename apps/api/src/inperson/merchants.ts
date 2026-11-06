import { createHmac, randomBytes } from "node:crypto";
import { encodeRequest, fromHex, inrToTestUnits, newNonce, toHex } from "@app/shared";
import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { merchants, payRequests, type User, worldChecks } from "../db/schema";
import { HireError } from "../hiring/errors";
import type { OwnWallet } from "../hiring/service";

/** A request is payable for 2 minutes: long enough to scan or hear, short for a replay. */
export const REQUEST_SECONDS = 120;
export const MAX_INR = 100_000;

/** The key the merchant's screen uses for this request's live codes (never the merchant's own). */
export const liveKeyFor = (keyHex: string, frameHex: string) =>
  createHmac("sha256", Buffer.from(keyHex, "hex")).update(`live|${frameHex}`).digest();

export const accountNumber = (account: string) => Number(account.split(".")[2]);

/** Whether this person proved they're a real person with World ID (the "verified" tick). */
export async function worldVerified(db: Db, userId: string) {
  const [c] = await db
    .select({ id: worldChecks.id })
    .from(worldChecks)
    .where(and(eq(worldChecks.userId, userId), eq(worldChecks.status, "verified")))
    .limit(1);
  return !!c;
}

export function merchantService(db: Db, ownWallet: OwnWallet) {
  const mine = async (userId: string) =>
    (await db.select().from(merchants).where(eq(merchants.userId, userId)))[0] ?? null;
  const view = async (m: typeof merchants.$inferSelect) => ({
    name: m.name,
    account: m.account,
    verified: await worldVerified(db, m.userId),
  });

  return {
    async get(user: User) {
      const m = await mine(user.id);
      return m ? await view(m) : null;
    },

    /** Get paid in person: into your own Face ID wallet, under the name you choose. */
    async become(user: User, name: string) {
      if (user.isDemo)
        throw new HireError("Getting paid needs your own Face ID wallet: sign in with a passkey.");
      // One real person per shop: so nobody can set up a look-alike "Chai Point" to be paid.
      if (!(await worldVerified(db, user.id)))
        throw new HireError(
          "Verify you're a real person with World ID first (Wallet → World ID), then set up your shop.",
        );
      const w = await ownWallet(user.id);
      if (w?.status !== "ready" || !w.hederaId)
        throw new HireError("Your Face ID wallet is still being set up. Try again in a moment.");
      const clean = name.trim().replace(/\s+/g, " ").slice(0, 40);
      const [taken] = await db
        .select({ id: merchants.userId })
        .from(merchants)
        .where(
          and(
            sql`lower(${merchants.name}) = ${clean.toLowerCase()}`,
            ne(merchants.userId, user.id),
          ),
        )
        .limit(1);
      if (taken)
        throw new HireError("That shop name is taken. Add your area, like “Chai Point, Bandra”.");
      const values = {
        name: clean,
        account: w.hederaId,
        address: w.address.toLowerCase(),
      };
      const [m] = await db
        .insert(merchants)
        .values({ userId: user.id, keyHex: randomBytes(32).toString("hex"), ...values })
        .onConflictDoUpdate({ target: merchants.userId, set: values })
        .returning();
      if (!m) throw new Error("could not save the merchant");
      return view(m);
    },

    /** A new request for `inr` rupees: its 24 bytes, signed, and the key for its live codes. */
    async request(user: User, inr: number) {
      const m = await mine(user.id);
      if (!m) throw new HireError("Set up getting paid first.");
      if (!Number.isInteger(inr) || inr < 1 || inr > MAX_INR)
        throw new HireError(`The amount must be ₹1 to ₹${MAX_INR.toLocaleString("en-IN")}.`);
      const units = inrToTestUnits(inr);
      const expiresAt = Math.floor(Date.now() / 1000) + REQUEST_SECONDS;
      const nonce = newNonce();
      const frame = await encodeRequest(
        { payee: accountNumber(m.account), amount: Number(units), nonce, expiresAt },
        fromHex(m.keyHex),
      );
      const frameHex = toHex(frame);
      const [r] = await db
        .insert(payRequests)
        .values({
          merchantUserId: user.id,
          nonce,
          frameHex,
          amountUnits: units,
          expiresAt: new Date(expiresAt * 1000),
        })
        .returning();
      if (!r) throw new Error("could not save the request");
      return {
        id: r.id,
        frame: frameHex,
        liveKey: liveKeyFor(m.keyHex, frameHex).toString("hex"),
        inr,
        expiresAt: r.expiresAt.toISOString(),
      };
    },

    /** Has it been paid? The merchant's screen asks until it has. */
    async status(user: User, id: string) {
      const [r] = await db
        .select()
        .from(payRequests)
        .where(and(eq(payRequests.id, id), eq(payRequests.merchantUserId, user.id)));
      if (!r) return null;
      const expired = r.status === "open" && r.expiresAt < new Date();
      return {
        status: expired ? ("expired" as const) : r.status,
        payTx: r.payTx,
        paidAt: r.paidAt?.toISOString() ?? null,
        how: r.how,
        live: r.live,
      };
    },
  };
}

export type MerchantService = ReturnType<typeof merchantService>;
