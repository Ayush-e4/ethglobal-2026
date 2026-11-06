import { cancelBookingMessage } from "@app/shared";
import { and, eq } from "drizzle-orm";
import type { LocalAccount } from "viem";
import type { Db } from "../db/client";
import { type Hire, hires, type User } from "../db/schema";
import { HireError } from "./errors";

/** A booked stay the guest can still cancel (every room we sell is refundable). */
export const canCancelBooking = (h: Hire) =>
  (h.status === "delivered" || h.status === "released") && !!h.bookingRef && !h.bookingCancelledAt;

/**
 * Cancel a booked stay, after the undo window: the agent cancels it at the hotel. The request is
 * signed with the concierge's key (the limit's AI key), which the agent checks against Hedera, so
 * nobody else can cancel someone's booking. The agent's fee stays paid: it booked as promised.
 */
export async function cancelBooking(
  d: { db: Db; concierge: LocalAccount },
  user: User,
  chatId: string,
  hireId: string,
): Promise<Hire> {
  const [hire] = await d.db
    .select()
    .from(hires)
    .where(and(eq(hires.id, hireId), eq(hires.chatId, chatId), eq(hires.userId, user.id)))
    .limit(1);
  if (!hire?.escrowId || !hire.jobUrl) throw new HireError("No such booking.");
  if (!canCancelBooking(hire))
    throw new HireError(
      hire.bookingCancelledAt
        ? "That booking is cancelled already."
        : "Only a booking that has been made can be cancelled.",
    );
  const signature = await d.concierge.signMessage({ message: cancelBookingMessage(hire.escrowId) });
  const res = await fetch(`${hire.jobUrl}/cancel-booking`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signature }),
    // The agent checks the escrow on Hedera, cancels with the supplier and may refund on-chain:
    // Hedera's RPC can take a while, so wait (the app shows it's working).
    signal: AbortSignal.timeout(150_000),
  }).catch((err) => {
    // Still at it (Hedera is slow): it finishes by itself, and the follower records it.
    if (err instanceof Error && err.name === "TimeoutError")
      throw new HireError(
        `${hire.agentName} is still cancelling it (Hedera is slow right now). This booking updates by itself once it's done.`,
      );
    return null;
  });
  const outcome = ((res ? await res.json().catch(() => null) : null) as { outcome?: string } | null)
    ?.outcome;
  if (outcome !== "cancelled")
    throw new HireError(
      `${hire.agentName} couldn't cancel it (${outcome ?? `HTTP ${res?.status ?? "unreachable"}`}).`,
    );
  const changes = { bookingCancelledAt: new Date(), watching: false, updatedAt: new Date() };
  await d.db.update(hires).set(changes).where(eq(hires.id, hire.id));
  return { ...hire, ...changes };
}
