import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { hires, lookups, payRequests, users } from "../db/schema";

const COUNTED = ["paying", "held", "delivered", "released"] as const; // undone or refunded fees don't count

/**
 * "Try the demo" spends from one shared wallet, so demo spending has daily caps: per account and
 * in total. Everything the demo wallet pays counts: an agent's fee and the trip price held with it,
 * lookups, and shops paid in person. Checked before paying; anything over is refused, in words.
 */
export async function demoCapsAllow(
  db: Db,
  userId: string,
  amount: bigint,
  caps: { perUser: bigint; total: bigint },
) {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const demoUsers = db.select({ id: users.id }).from(users).where(eq(users.isDemo, true));
  const sum = async (byUser: boolean) => {
    const [h] = await db
      .select({
        v: sql<string>`coalesce(sum(${hires.feeUnits} + coalesce(${hires.priceUnits}, 0)), 0)`,
      })
      .from(hires)
      .where(
        and(
          eq(hires.demo, true),
          gte(hires.createdAt, since),
          inArray(hires.status, [...COUNTED]),
          ...(byUser ? [eq(hires.userId, userId)] : []),
        ),
      );
    const [l] = await db
      .select({ v: sql<string>`coalesce(sum(${lookups.feeUnits}), 0)` })
      .from(lookups)
      .where(
        and(
          eq(lookups.status, "answered"),
          gte(lookups.createdAt, since),
          byUser ? eq(lookups.userId, userId) : inArray(lookups.userId, demoUsers),
        ),
      );
    const [p] = await db
      .select({ v: sql<string>`coalesce(sum(${payRequests.amountUnits}), 0)` })
      .from(payRequests)
      .where(
        and(
          eq(payRequests.status, "paid"),
          gte(payRequests.createdAt, since),
          byUser
            ? eq(payRequests.payerUserId, userId)
            : inArray(payRequests.payerUserId, demoUsers),
        ),
      );
    return BigInt(h?.v ?? 0) + BigInt(l?.v ?? 0) + BigInt(p?.v ?? 0);
  };
  if ((await sum(true)) + amount > caps.perUser)
    return "This demo account's daily spending is used up. Try again tomorrow.";
  if ((await sum(false)) + amount > caps.total)
    return "The demo's daily budget is used up. Try again tomorrow.";
  return null;
}
