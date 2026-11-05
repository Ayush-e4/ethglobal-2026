import type { Db } from "../db/client";
import { quotes } from "../db/schema";
import type { HotelQuote } from "./market";

/** "2026-12-14", "2026-12-16" → "14–16 Dec"; across months "30 Dec – 2 Jan". */
export function stay(checkin: string, checkout: string) {
  const day = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  const [a, b] = [day(checkin), day(checkout)];
  const [d1, m1] = a.split(" ");
  const [d2, m2] = b.split(" ");
  return m1 === m2 ? `${d1}–${d2} ${m2}` : `${a} – ${b}`;
}

/** Remembers the quotes shown in a chat (until they expire), so only those can be booked from it. */
export async function saveQuotes(db: Db, chatId: string, shown: HotelQuote[]): Promise<void> {
  if (shown.length === 0) return;
  await db
    .insert(quotes)
    .values(
      shown.map((q) => ({
        key: q.key,
        chatId,
        agentName: q.agent.name,
        agentAddress: q.agent.agent.toLowerCase(),
        endpoint: q.agent.endpoint,
        feeUnits: BigInt(q.feeUnits),
        summary: `${q.hotelName} · ${stay(q.checkin, q.checkout)}`.slice(0, 200),
        expiresAt: new Date(Date.now() + 170_000), // a little under the agent's 3 minutes
      })),
    )
    .onConflictDoNothing();
}
