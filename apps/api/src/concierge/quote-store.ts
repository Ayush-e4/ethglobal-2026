import type { Db } from "../db/client";
import { quotes } from "../db/schema";
import type { HotelQuote } from "./market";

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
        summary:
          `${q.hotelName}, ${q.checkin} to ${q.checkout}, ${q.currency} ${Math.round(q.total)}`.slice(
            0,
            200,
          ),
        expiresAt: new Date(Date.now() + 170_000), // a little under the agent's 3 minutes
      })),
    )
    .onConflictDoNothing();
}
