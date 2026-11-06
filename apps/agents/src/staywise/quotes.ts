import { postQuote, type SafeArkivWriter } from "@app/arkiv";
import { type Offer, parseUsdc, stay } from "@app/shared";
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
  // A rate can sell out between search and prebook (LiteAPI answers 409): try the next ones.
  let found: {
    best: (typeof offers)[number];
    pre: Awaited<ReturnType<LiteApiClient["prebook"]>>;
  } | null = null;
  for (const offer of offers.slice(0, 4)) {
    const pre = await d.lite.prebook(offer.offerId).catch(() => null);
    if (pre) {
      found = { best: offer, pre };
      break;
    }
  }
  if (!found) return null;
  const { best, pre } = found;
  const feeUnits = parseUsdc(d.feeUsd.replace("$", "")).toString();
  // Also the hire's title in the buyer's app: "Park Inn by Radisson Goa Candolim · 14–16 Dec".
  const summary = `${best.hotelName} · ${stay(q.checkin, q.checkout)}`;
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

/** A stored quote as the market sees it (never the prebook id: that stays with us). */
export function toOffer(q: StoredQuote): Offer {
  const nights = Math.round((Date.parse(q.checkout) - Date.parse(q.checkin)) / 86_400_000);
  return {
    key: q.key,
    title: q.hotelName,
    subtitle: q.roomName,
    summary: `${q.hotelName} · ${stay(q.checkin, q.checkout)}`,
    feeUnits: q.feeUnits,
    price: { amount: q.total, currency: q.currency },
    refundable: q.refundable,
    details: [
      `${nights} night${nights === 1 ? "" : "s"}`,
      `${q.adults} adult${q.adults === 1 ? "" : "s"}`,
    ],
  };
}
