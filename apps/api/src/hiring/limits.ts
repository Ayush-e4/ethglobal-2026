import type { MandateClient } from "@app/mandates";
import { parseUsdc } from "@app/shared";
import { and, desc, eq, gt } from "drizzle-orm";
import type { LocalAccount } from "viem";
import type { Db } from "../db/client";
import { type Limit, limits } from "../db/schema";

const BUDGET = parseUsdc("0.10");
const CAP = parseUsdc("0.05");
const DAY = 24 * 3600 * 1000;

/**
 * The chat's spending limit for one agent, on Hedera: reused while it has room, otherwise made
 * (the owner lets the registry pull up to the budget, then creates the mandate for the AI's key).
 * The chain enforces it; this row only remembers which mandate belongs to which chat.
 */
export async function limitFor(
  d: {
    db: Db;
    registry: MandateClient;
    owner: LocalAccount;
    ownerAccount: string;
    concierge: `0x${string}`;
    token: `0x${string}`;
  },
  chatId: string,
  payee: `0x${string}`,
  fee: bigint,
  demo: boolean,
): Promise<Limit> {
  const live = await d.db
    .select()
    .from(limits)
    .where(
      and(
        eq(limits.chatId, chatId),
        eq(limits.payee, payee.toLowerCase()),
        gt(limits.expiresAt, new Date(Date.now() + 10 * 60_000)),
      ),
    )
    .orderBy(desc(limits.createdAt))
    .limit(1);
  const existing = live[0];
  if (
    existing &&
    (await d.registry.remaining(existing.mandateId)) >= fee &&
    (await d.registry.isActive(existing.mandateId))
  ) {
    return existing;
  }
  const allowance = await d.registry.allowance(d.token, d.owner.address);
  if (allowance < BUDGET) await d.registry.approve(d.owner, d.token, allowance + BUDGET);
  const expiresAt = new Date(Date.now() + DAY);
  const { id } = await d.registry.createMandate(d.owner, {
    agent: d.concierge,
    token: d.token,
    budget: BUDGET,
    perPaymentCap: CAP,
    expiresAt: BigInt(Math.floor(expiresAt.getTime() / 1000)),
    payees: [payee],
  });
  const [row] = await d.db
    .insert(limits)
    .values({
      chatId,
      mandateId: id,
      owner: d.owner.address,
      ownerAccount: d.ownerAccount,
      payee: payee.toLowerCase(),
      budgetUnits: BUDGET,
      demo,
      expiresAt,
    })
    .returning();
  if (!row) throw new Error("could not save the limit");
  return row;
}
