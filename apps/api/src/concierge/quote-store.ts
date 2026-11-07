import type { Db } from "../db/client";
import { quotes } from "../db/schema";
import type { MarketOffer } from "./market";

/** Remembers the offers shown in a chat (until they expire), so only those can be booked from it. */
export async function saveQuotes(db: Db, chatId: string, shown: MarketOffer[]): Promise<void> {
  if (shown.length === 0) return;
  await db
    .insert(quotes)
    .values(
      shown.map((o) => ({
        key: o.key,
        chatId,
        agentName: o.agent.name,
        agentAddress: o.agent.agent.toLowerCase(),
        endpoint: o.agent.endpoint,
        feeUnits: BigInt(o.feeUnits),
        summary: o.summary.slice(0, 200), // the agent's own line; becomes the hire's title
        image: o.images?.[0] ?? null,
        guestFields: o.agent.guestFields ?? [],
        priceUnits: o.priceUnits ? BigInt(o.priceUnits) : null,
        expiresAt: new Date(Date.now() + 590_000), // a little under the agent's 10 minutes
      })),
    )
    .onConflictDoNothing();
}
