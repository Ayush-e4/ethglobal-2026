import { recordDispute, type SafeArkivWriter } from "@app/arkiv";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { type Hire, quotes } from "../db/schema";
import type { DisputeHook, DisputeReason } from "./disputes";

/**
 * Disputes on the public record (Arkiv), written by our platform: filed, then how they ended.
 * The market counts them per agent, so a buyer's report warns every buyer after them.
 */
export function arkivDisputes(db: Db, platform: SafeArkivWriter | null) {
  const reasons = new Map<string, DisputeReason>(); // hire → why it was reported
  const post = async (hire: Hire, reason: DisputeReason, outcome: "open" | "refunded") => {
    if (!platform || !hire.escrowId) return;
    const [q] = await db
      .select({ agent: quotes.agentAddress })
      .from(quotes)
      .where(eq(quotes.key, hire.quoteKey));
    if (!q) return;
    await recordDispute(platform, { agent: q.agent, job: hire.escrowId, reason, outcome }).catch(
      (e) =>
        console.error(`arkiv dispute for hire ${hire.id.slice(0, 8)}: ${String(e).slice(0, 120)}`),
    );
  };
  const onDispute: DisputeHook = async (hire, reason, outcome) => {
    reasons.set(hire.id, reason);
    await post(hire, reason, outcome);
  };
  return {
    onDispute,
    onSettled: (hire: Hire) => post(hire, reasons.get(hire.id) ?? "other", "refunded"),
  };
}
