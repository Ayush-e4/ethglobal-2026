import type { MandateClient } from "@app/mandates";
import { and, eq } from "drizzle-orm";
import type { LocalAccount } from "viem";
import { z } from "zod";
import type { Db } from "../db/client";
import { type Hire, hires, type User } from "../db/schema";
import { HireError } from "./errors";

export const DISPUTE_REASONS = {
  not_found: "The hotel can't find my booking",
  wrong_details: "Wrong dates, room or guest",
  other: "Something else",
} as const;
export type DisputeReason = keyof typeof DISPUTE_REASONS;
export const DisputeReasonSchema = z.enum(["not_found", "wrong_details", "other"]);

/** What the chat says once a problem is reported (so the concierge knows, too). */
export const reportedNote = (hire: Hire, reason: DisputeReason) =>
  `Reported to ${hire.agentName}: "${DISPUTE_REASONS[reason]}". The ${(Number(hire.feeUnits) / 1e6).toFixed(2)} USDC fee is frozen on Hedera, so ${hire.agentName} isn't paid while it sorts this out.`;

/** A dispute filed or settled, for the public record (Arkiv) and anyone else who listens. */
export type DisputeHook = (
  hire: Hire,
  reason: DisputeReason,
  outcome: "open" | "refunded",
) => Promise<unknown>;

/**
 * The buyer reports a problem with a delivered booking, within its review window. The fee freezes
 * on Hedera (the concierge is a buyer on every limit, like undo: no Face ID), the dispute goes on
 * the record, and the agent is told. It settles by refunding (the follower sees it); until then
 * it's never paid.
 */
export async function disputeHire(
  d: { db: Db; registry: MandateClient; concierge: LocalAccount; onDispute?: DisputeHook },
  user: User,
  chatId: string,
  hireId: string,
  reason: DisputeReason,
): Promise<Hire> {
  const [hire] = await d.db
    .select()
    .from(hires)
    .where(and(eq(hires.id, hireId), eq(hires.chatId, chatId), eq(hires.userId, user.id)))
    .limit(1);
  if (!hire?.escrowId) throw new HireError("No such hire.");
  if (hire.status === "disputed") return hire;
  if (hire.status !== "delivered" || !hire.reviewUntil || hire.reviewUntil <= new Date())
    throw new HireError("Too late to report a problem: the review window has ended.");
  await d.registry.dispute(d.concierge, hire.escrowId as `0x${string}`);
  const changes = {
    status: "disputed" as const,
    note: `reported: ${DISPUTE_REASONS[reason]}`,
    updatedAt: new Date(),
  };
  await d.db.update(hires).set(changes).where(eq(hires.id, hire.id));
  const disputed = { ...hire, ...changes };
  await d.onDispute?.(disputed, reason, "open").catch(() => {});
  // Tell the agent (it checks Hedera itself before doing anything). Not waited for: it may settle
  // within seconds, and the chat should say "reported" before it says "refunded".
  if (hire.jobUrl)
    void fetch(`${hire.jobUrl}/dispute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
  return disputed;
}
