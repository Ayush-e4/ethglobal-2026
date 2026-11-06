import type { MandateClient, MandateParams } from "@app/mandates";
import { type Card, parseUsdc } from "@app/shared";
import { and, desc, eq, gt } from "drizzle-orm";
import type { LocalAccount } from "viem";
import type { Db } from "../db/client";
import { type Limit, limits } from "../db/schema";

/** A chat's limit for one agent: up to 0.10 USDC, 0.05 a payment, for a day. */
// Room for a trip price (at testnet scale) as well as the fee.
export const LIMIT_TERMS = { budget: parseUsdc("0.50"), cap: parseUsdc("0.20"), hours: 24 };

/**
 * No limit with room for this agent in this chat yet, and the money is the user's own: they
 * approve one with Face ID first (the card), then the booking carries on.
 */
export class NeedsLimit extends Error {
  constructor(readonly card: Extract<Card, { type: "limit" }>) {
    super(`${card.agentName} needs a spending limit approved with Face ID first`);
  }
}

/** The terms of a new limit: the AI's key may pay this one agent, within LIMIT_TERMS. */
export function limitParams(
  concierge: `0x${string}`,
  token: `0x${string}`,
  payee: `0x${string}`,
): MandateParams {
  const expiresAt = Math.floor(Date.now() / 1000) + LIMIT_TERMS.hours * 3600;
  return {
    agent: concierge,
    token,
    budget: LIMIT_TERMS.budget,
    perPaymentCap: LIMIT_TERMS.cap,
    expiresAt: BigInt(expiresAt),
    payees: [payee],
  };
}

/**
 * This chat's live limit for `payee`, owned by `owner`, with room for `fee` (the chain decides:
 * the row only remembers which mandate belongs to which chat). Null if there's none.
 */
export async function liveLimit(
  db: Db,
  registry: MandateClient,
  chatId: string,
  payee: string,
  fee: bigint,
  owner: string,
): Promise<Limit | null> {
  const rows = await db
    .select()
    .from(limits)
    .where(
      and(
        eq(limits.chatId, chatId),
        eq(limits.payee, payee.toLowerCase()),
        gt(limits.expiresAt, new Date(Date.now() + 10 * 60_000)),
      ),
    )
    .orderBy(desc(limits.createdAt));
  for (const l of rows) {
    if (l.owner.toLowerCase() !== owner.toLowerCase()) continue;
    // Room left, and a per-payment cap that fits (older limits had a lower cap).
    if (
      (await registry.remaining(l.mandateId)) >= fee &&
      (await registry.getMandate(l.mandateId)).perPaymentCap >= fee &&
      (await registry.isActive(l.mandateId))
    )
      return l;
  }
  return null;
}

/**
 * A demo chat's limit for one agent, from the shared demo wallet: reused while it has room,
 * otherwise made (the owner lets the registry pull up to the budget, then creates the mandate).
 */
export async function demoLimitFor(
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
): Promise<Limit> {
  const existing = await liveLimit(d.db, d.registry, chatId, payee, fee, d.owner.address);
  if (existing) return existing;
  const p = limitParams(d.concierge, d.token, payee);
  const allowance = await d.registry.allowance(d.token, d.owner.address);
  if (allowance < p.budget) await d.registry.approve(d.owner, d.token, allowance + p.budget);
  const { id } = await d.registry.createMandate(d.owner, p);
  const [row] = await d.db
    .insert(limits)
    .values({
      chatId,
      mandateId: id,
      owner: d.owner.address.toLowerCase(),
      ownerAccount: d.ownerAccount,
      payee: payee.toLowerCase(),
      budgetUnits: p.budget,
      demo: true,
      expiresAt: new Date(Number(p.expiresAt) * 1000),
    })
    .returning();
  if (!row) throw new Error("could not save the limit");
  return row;
}
