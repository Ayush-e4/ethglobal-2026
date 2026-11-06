import type { DuffelClient } from "@app/travel";
import type { Guest, Supplier } from "../jobs/types";
import type { FlightQuote } from "./types";

/** What a flight needs that a hotel doesn't, said before anything is paid. */
export const passengerProblem = (g: Guest) =>
  g.bornOn && g.gender
    ? null
    : "A flight needs the traveller's date of birth and gender, as on their ID. Add them to the traveller (Settings → Travellers) and book again.";

/**
 * SkyHop's supplier: Duffel books the flight at the fare quoted (not if it went up by more than
 * 2%), paid from the test balance, and cancels it.
 */
export const flightSupplier = (duffel: DuffelClient): Supplier<FlightQuote> => ({
  merchant: (q) => ({
    name: q.airline,
    amount: q.inr ?? q.total,
    currency: q.inr ? "INR" : q.currency,
  }),
  book: async (q, g) => {
    const problem = passengerProblem(g);
    if (problem || !g.bornOn || !g.gender) throw new Error(problem ?? "passenger details missing");
    const now = await duffel.offer(q.offerId);
    if (now.total > q.total * 1.02)
      throw new Error(`the fare went up from ${q.total} to ${now.total} ${now.currency}`);
    const o = await duffel.book(q.offerId, { ...g, bornOn: g.bornOn, gender: g.gender });
    return { bookingId: o.orderId, reference: o.bookingRef };
  },
  cancel: (orderId) => duffel.cancel(orderId),
});
