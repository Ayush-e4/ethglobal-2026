import { postQuotes, type SafeArkivWriter } from "@app/arkiv";
import { type Offer, parseUsdc, stay } from "@app/shared";
import type { HotelOffer, LiteApiClient } from "@app/travel";
import type { JsonStore } from "../store";
import type { StoredQuote } from "./types";

const QUOTE_SECONDS = 180;
// What a guest looks for, as one clean label each ("Pool", not "Pool hoist on site"), in order.
const NICE: [RegExp, string][] = [
  [/\bpool\b/i, "Pool"],
  [/\bspa\b/i, "Spa"],
  [/\bbeach/i, "Beach"],
  [/free wi-?fi/i, "Free WiFi"],
  [/airport shuttle/i, "Airport shuttle"],
  [/\b(fitness|gym)\b/i, "Gym"],
  [/\brestaurant/i, "Restaurant"],
  [/free parking/i, "Free parking"],
];

type Slot = { tag: string; better: (a: HotelOffer, b: HotelOffer) => number };
/** Three different hotels, each here for a reason. */
const SLOTS: Slot[] = [
  { tag: "Cheapest", better: (a, b) => a.total - b.total },
  { tag: "Best rated", better: (a, b) => (b.score ?? 0) - (a.score ?? 0) || a.total - b.total },
  { tag: "Best value", better: (a, b) => (b.score ?? 0) / b.total - (a.score ?? 0) / a.total },
];

/** The hotel's best facilities as clean labels, at most `n`, one each. */
export function topFacilities(all: string[], n = 3) {
  return NICE.filter(([match]) => all.some((f) => match.test(f)))
    .map(([, label]) => label)
    .slice(0, n);
}

/**
 * Up to three firm quotes for a stay: the cheapest, the best rated and the best value (guests'
 * score for the price), all refundable. Each price is locked with a prebook (a sold-out rate
 * gives its place to the next hotel) and all three are posted on Arkiv in one transaction,
 * expiring in 3 minutes. Free: the fee is only paid to book.
 */
export async function makeQuotes(
  d: {
    lite: LiteApiClient;
    arkiv: SafeArkivWriter;
    quotes: JsonStore<StoredQuote>;
    feeUsd: string;
  },
  q: {
    task: string;
    iataCode: string;
    area?: string;
    checkin: string;
    checkout: string;
    adults: number;
    maxTotal?: number;
    minStars?: number;
  },
): Promise<StoredQuote[]> {
  const placeId = q.area ? await d.lite.findPlace(q.area).catch(() => null) : null;
  const found = await d.lite.searchHotels({
    ...(placeId ? { placeId } : { iataCode: q.iataCode }),
    checkin: q.checkin,
    checkout: q.checkout,
    adults: q.adults,
    refundableOnly: true,
    limit: 20,
  });
  let pool = found.filter(
    (o) =>
      (q.maxTotal === undefined || o.total <= q.maxTotal) &&
      (q.minStars === undefined || (o.stars ?? 0) >= q.minStars),
  );
  // One hotel per slot, each locked with a prebook, all at once. A rate can sell out between
  // search and prebook (LiteAPI answers 409): that slot then tries the next hotels in turn.
  type Locked = {
    offer: HotelOffer;
    tag: string;
    pre: Awaited<ReturnType<LiteApiClient["prebook"]>>;
  };
  const first: { slot: Slot; offer: HotelOffer }[] = [];
  for (const slot of SLOTS) {
    const offer = [...pool].sort(slot.better)[0];
    if (!offer) break;
    first.push({ slot, offer });
    pool = pool.filter((o) => o !== offer);
  }
  const prebook = (o: HotelOffer) => d.lite.prebook(o.offerId).catch(() => null);
  const tried = await Promise.all(first.map(async (f) => ({ ...f, pre: await prebook(f.offer) })));
  const locked: Locked[] = [];
  for (const { slot, offer, pre } of tried) {
    if (pre) {
      locked.push({ offer, tag: slot.tag, pre });
      continue;
    }
    for (const next of [...pool].sort(slot.better).slice(0, 2)) {
      pool = pool.filter((o) => o !== next);
      const again = await prebook(next);
      if (again) {
        locked.push({ offer: next, tag: slot.tag, pre: again });
        break;
      }
    }
  }
  if (locked.length === 0) return [];
  // Labels stay true for what's shown: after a sold-out swap, "Cheapest" is the cheapest here.
  const shown: Locked[] = [];
  let rest = [...locked];
  for (const slot of SLOTS) {
    const best = [...rest].sort((a, b) => slot.better(a.offer, b.offer))[0];
    if (!best) break;
    shown.push({ ...best, tag: slot.tag });
    rest = rest.filter((x) => x !== best);
  }
  const details = await Promise.all(
    shown.map(({ offer }) =>
      d.lite.hotelDetails(offer.hotelId).catch(() => ({ images: [], facilities: [] as string[] })),
    ),
  );
  const feeUnits = parseUsdc(d.feeUsd.replace("$", "")).toString();
  const summaries = shown.map(({ offer }) => `${offer.hotelName} · ${stay(q.checkin, q.checkout)}`);
  const { keys } = await postQuotes(
    d.arkiv,
    summaries.map((summary) => ({
      agent: d.arkiv.address,
      task: q.task,
      skill: "hotels",
      feeUnits,
      summary,
    })),
    QUOTE_SECONDS,
  );
  return shown.map(({ offer, tag, pre }, i) => {
    const stored: StoredQuote = {
      key: keys[i] as `0x${string}`,
      task: q.task,
      prebookId: pre.prebookId,
      hotelName: offer.hotelName,
      roomName: offer.roomName,
      total: pre.total,
      currency: pre.currency,
      checkin: q.checkin,
      checkout: q.checkout,
      adults: q.adults,
      refundable: pre.refundable,
      feeUnits,
      expiresAtMs: Date.now() + QUOTE_SECONDS * 1000,
      tag,
      board: offer.board,
      photos: [
        ...new Set([offer.photo, ...(details[i]?.images ?? [])].filter((u) => u !== undefined)),
      ],
      area: offer.area,
      address: offer.address,
      score: offer.score,
      stars: offer.stars,
      reviews: offer.reviews,
      facilities: topFacilities(details[i]?.facilities ?? []),
    };
    d.quotes.set(stored.key, stored);
    return stored;
  });
}

/** A stored quote as the market sees it (never the prebook id: that stays with us). */
export function toOffer(q: StoredQuote): Offer {
  const nights = Math.round((Date.parse(q.checkout) - Date.parse(q.checkin)) / 86_400_000);
  return {
    key: q.key,
    title: q.hotelName,
    tag: q.tag,
    subtitle: [q.roomName, q.board].filter(Boolean).join(" · ").slice(0, 160),
    summary: `${q.hotelName} · ${stay(q.checkin, q.checkout)}`,
    feeUnits: q.feeUnits,
    price: { amount: q.total, currency: q.currency },
    refundable: q.refundable,
    rating: q.score || q.stars ? { stars: q.stars, score: q.score, reviews: q.reviews } : undefined,
    // The area, and the street only when it's short (some are survey numbers and pin codes).
    location:
      [q.area, q.address && q.address.length <= 32 ? q.address : null]
        .filter(Boolean)
        .join(" · ") || undefined,
    images: q.photos?.slice(0, 4),
    details: [
      `${nights} night${nights === 1 ? "" : "s"}, ${q.adults} adult${q.adults === 1 ? "" : "s"}`,
      ...(q.facilities ?? []),
    ].slice(0, 6),
  };
}
