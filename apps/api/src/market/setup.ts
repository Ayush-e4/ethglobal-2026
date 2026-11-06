import { arkivReader, type SafeArkivWriter } from "@app/arkiv";
import { arkivMarket } from "../concierge/market";
import type { Db } from "../db/client";
import { type AgentReviewService, agentReviewService } from "./reviews";

/**
 * The market and its gate: agents on Arkiv, shown only once our review approves them (set
 * MARKET_REVIEW=off to show every agent, e.g. in a scratch setup). HOUSE_AGENTS lists our own
 * agents' addresses: we answer for those, and review them without an owner.
 */
export function marketplace(db: Db, platform: SafeArkivWriter | null, appOrigin: string) {
  const reader = arkivReader();
  const gated = process.env.MARKET_REVIEW !== "off";
  let reviews: AgentReviewService | null = null;
  const market = arkivMarket(
    reader,
    fetch,
    platform?.address,
    gated ? async () => (reviews ? reviews.shown() : new Set<string>()) : undefined,
  );
  reviews = agentReviewService(db, {
    market,
    reader,
    writer: platform,
    registryId: process.env.MANDATE_REGISTRY_ID ?? "",
    house: new Set(
      (process.env.HOUSE_AGENTS ?? "")
        .split(",")
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean),
    ),
    allowLocalHttp: ["localhost", "127.0.0.1"].includes(new URL(appOrigin).hostname),
  });
  return { market, reviews };
}
