import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { hires } from "../db/schema";

const COUNTED = ["paying", "held", "delivered", "released"] as const; // undone or refunded fees don't count

/**
 * "Try the demo" spends from one shared wallet, so demo hires have daily caps: per account and
 * in total. Checked before paying; a hire that would go over is refused with a clear reason.
 */
export async function demoCapsAllow(
  db: Db,
  userId: string,
  fee: bigint,
  caps: { perUser: bigint; total: bigint },
) {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const sum = async (byUser: boolean) => {
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${hires.feeUnits}), 0)` })
      .from(hires)
      .where(
        and(
          eq(hires.demo, true),
          gte(hires.createdAt, since),
          inArray(hires.status, [...COUNTED]),
          ...(byUser ? [eq(hires.userId, userId)] : []),
        ),
      );
    return BigInt(row?.total ?? 0);
  };
  if ((await sum(true)) + fee > caps.perUser)
    return "This demo account's daily spending is used up. Try again tomorrow.";
  if ((await sum(false)) + fee > caps.total)
    return "The demo's daily budget is used up. Try again tomorrow.";
  return null;
}
