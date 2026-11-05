import { postQuote, type SafeArkivWriter } from "@app/arkiv";
import { parseUsdc } from "@app/shared";
import type { LiteApiClient } from "@app/travel";
import type { JsonStore } from "../store";
import type { StoredQuote } from "./types";

const QUOTE_SECONDS = 180;

/**
 * Finds the cheapest refundable room near the airport, locks its price with a prebook and posts
 * a firm quote on Arkiv that expires in 3 minutes. Free: the fee is only paid to book.
 */
export async function makeQuote(
  d: {
    lite: LiteApiClient;
    arkiv: SafeArkivWriter;
    quotes: JsonStore<StoredQuote>;
    feeUsd: string;
  },
  q: { task: string; iataCode: string; checkin: string; checkout: string; adults: number },
): Promise<StoredQuote | null> {
  const offers = await d.lite.searchHotels({ ...q, refundableOnly: true, limit: 10 });
  const best = offers[0];
  if (!best) return null;
  const pre = await d.lite.prebook(best.offerId);
  const nights = Math.round((Date.parse(q.checkout) - Date.parse(q.checkin)) / 86_400_000);
  const feeUnits = parseUsdc(d.feeUsd.replace("$", "")).toString();
  const summary = `${best.hotelName}, ${nights} night${nights === 1 ? "" : "s"}, ${pre.currency} ${Math.round(pre.total)}${pre.refundable ? ", free cancellation" : ""}`;
  const { entityKey } = await postQuote(
    d.arkiv,
    {
      agent: d.arkiv.address,
      task: q.task,
      skill: "hotels",
      feeUnits,
      summary: summary.slice(0, 500),
    },
    QUOTE_SECONDS,
  );
  const stored: StoredQuote = {
    key: entityKey,
    task: q.task,
    prebookId: pre.prebookId,
    hotelName: best.hotelName,
    roomName: best.roomName,
    total: pre.total,
    currency: pre.currency,
    checkin: q.checkin,
    checkout: q.checkout,
    adults: q.adults,
    refundable: pre.refundable,
    feeUnits,
    expiresAtMs: Date.now() + QUOTE_SECONDS * 1000,
  };
  d.quotes.set(entityKey, stored);
  return stored;
}
