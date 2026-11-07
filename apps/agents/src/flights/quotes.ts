import { postQuotes, type SafeArkivWriter } from "@app/arkiv";
import { inrToTestUnits, type Offer, parseUsdc } from "@app/shared";
import type { DuffelClient, FlightLeg, FlightOffer } from "@app/travel";
import type { JsonStore } from "../store";
import { type InrRate, rupees } from "./fx";
import type { FlightQuote } from "./types";

const QUOTE_SECONDS = 600; // 10 min: long enough for a Face ID limit or a World ID approval in between
const minutes = (o: FlightOffer) => o.legs.reduce((n, l) => n + l.minutes, 0);
/** The same flights at the same price are one choice, however many fare codes they come in. */
const same = (o: FlightOffer) => `${o.legs.map((l) => l.flights.join("+")).join("/")}:${o.total}`;

type Slot = {
  tag: string;
  better: (a: FlightOffer, b: FlightOffer) => number;
  fits?: (o: FlightOffer, picked: FlightOffer[]) => boolean;
};
const departs = (o: FlightOffer) => o.legs[0]?.departAt ?? "";
/** Three different flights, each here for a reason (a slot nothing fits is skipped). */
const SLOTS: Slot[] = [
  { tag: "Cheapest", better: (a, b) => a.total - b.total },
  { tag: "Fastest", better: (a, b) => minutes(a) - minutes(b) || a.total - b.total },
  {
    tag: "Most flexible",
    better: (a, b) =>
      Number(b.refundable) - Number(a.refundable) ||
      Number(b.changeable) - Number(a.changeable) ||
      a.total - b.total,
    fits: (o) => o.refundable || o.changeable,
  },
  {
    tag: "Another time",
    better: (a, b) => a.total - b.total,
    fits: (o, picked) => !picked.some((p) => departs(p) === departs(o)),
  },
];

/** The cheapest, the fastest and the most flexible (or another time) of the offers, each a different flight. */
export function pickThree(offers: FlightOffer[]): { offer: FlightOffer; tag: string }[] {
  const unique = offers.filter((o, i) => offers.findIndex((x) => same(x) === same(o)) === i);
  const picked: { offer: FlightOffer; tag: string }[] = [];
  for (const s of SLOTS) {
    if (picked.length === 3) break;
    const best = unique
      .filter((o) => !picked.some((p) => same(p.offer) === same(o)))
      .filter(
        (o) =>
          s.fits?.(
            o,
            picked.map((p) => p.offer),
          ) ?? true,
      )
      .sort(s.better)[0];
    if (best) picked.push({ offer: best, tag: s.tag });
  }
  return picked;
}

const hhmm = (iso: string) => iso.slice(11, 16);
const day = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const length = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const stops = (l: FlightLeg) => (l.stops === 0 ? "nonstop" : `${l.stops} stop`);
const nextDay = (l: FlightLeg) => (l.arriveAt.slice(0, 10) > l.departAt.slice(0, 10) ? " +1" : "");
/** "20 Dec 14:42 → 15:50 · 1h 08m nonstop · BA 0117" (+1 when it lands the next day). */
export const legLine = (l: FlightLeg) =>
  `${day(l.departAt)} ${hhmm(l.departAt)} → ${hhmm(l.arriveAt)}${nextDay(l)} · ${length(l.minutes)} ${stops(l)} · ${l.flights.join(", ")}`;
/** "Air India · BOM → GOI · 20 Dec" (and back, for a return). */
export const flightSummary = (q: { airline: string; legs: FlightLeg[] }) => {
  const [out, back] = q.legs;
  if (!out) return q.airline;
  return `${q.airline} · ${out.from} → ${out.to}${back ? " and back" : ""} · ${day(out.departAt)}${back ? `–${day(back.departAt)}` : ""}`;
};

/**
 * Up to three flights, posted on Arkiv in one transaction, expiring in 10 minutes. Free: the fee
 * is only paid to book. The fare is re-checked when booking.
 */
export async function makeFlightQuotes(
  d: {
    duffel: DuffelClient;
    arkiv: SafeArkivWriter;
    quotes: JsonStore<FlightQuote>;
    feeUsd: string;
    inrRate?: InrRate; // shows fares in rupees
  },
  q: { task: string; from: string; to: string; date: string; returnDate?: string },
): Promise<FlightQuote[]> {
  const shown = pickThree(await d.duffel.search(q));
  if (shown.length === 0) return [];
  const rate = shown[0] ? await (d.inrRate?.(shown[0].offer.currency) ?? null) : null;
  const inr = (o: FlightOffer) => (rate ? Math.round(o.total * rate) : undefined);
  const feeUnits = parseUsdc(d.feeUsd.replace("$", "")).toString();
  const { keys } = await postQuotes(
    d.arkiv,
    shown.map(({ offer }) => ({
      agent: d.arkiv.address,
      task: q.task,
      skill: "flights",
      feeUnits,
      summary: `${flightSummary(offer)} · ${offer.currency} ${offer.total.toFixed(2)}${rate ? ` (about ${rupees(offer.total * rate)})` : ""}`,
    })),
    QUOTE_SECONDS,
  );
  return shown.map(({ offer, tag }, i) => {
    const stored: FlightQuote = {
      key: keys[i] as `0x${string}`,
      task: q.task,
      offerId: offer.offerId,
      airline: offer.airline,
      legs: offer.legs,
      total: offer.total,
      currency: offer.currency,
      inr: inr(offer),
      ...(inr(offer) ? { priceUnits: inrToTestUnits(inr(offer) as number).toString() } : {}),
      refundable: offer.refundable,
      changeable: offer.changeable,
      emissionsKg: offer.emissionsKg,
      feeUnits,
      expiresAtMs: Date.now() + QUOTE_SECONDS * 1000,
      tag,
    };
    d.quotes.set(stored.key, stored);
    return stored;
  });
}

/** What the market shows of a flight. */
export function toFlightOffer(q: FlightQuote): Offer {
  const [out, back] = q.legs;
  return {
    key: q.key,
    title: q.airline, // the app shows "<title> · <agent>": no " · " in it
    tag: q.tag,
    subtitle: out
      ? `${out.from} → ${out.to}${back ? " and back" : ""} · ${legLine(out)}`.slice(0, 160)
      : undefined,
    summary: flightSummary(q),
    feeUnits: q.feeUnits,
    // In rupees when we have today's rate; the details say what it's charged in.
    price: q.inr ? { amount: q.inr, currency: "INR" } : { amount: q.total, currency: q.currency },
    priceUnits: q.priceUnits,
    refundable: q.refundable,
    details: [
      ...(back ? [`Back: ${legLine(back)}`] : []),
      ...(q.inr ? [`Fare ${q.currency} ${q.total.toFixed(2)}, about ${rupees(q.inr)} today`] : []),
      q.changeable ? "Changes allowed" : "No changes",
      "Economy, one passenger",
      ...(q.emissionsKg ? [`${q.emissionsKg} kg CO₂`] : []),
    ].slice(0, 6),
  };
}
