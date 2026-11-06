import type { LiteApiClient } from "@app/travel";
import type { Supplier } from "../jobs/types";
import { JobWorker } from "../jobs/worker";
import type { StoredQuote, Watch } from "./types";

/** A hotel agent's supplier: LiteAPI books the prebooked room, and cancels it (all refundable). */
export const hotelSupplier = (lite: LiteApiClient): Supplier<StoredQuote> => ({
  book: async (q, guest, ref) => {
    const b = await lite.book(q.prebookId, guest, ref);
    return { bookingId: b.bookingId, confirmation: b.confirmationCode };
  },
  cancel: (bookingId) => lite.cancel(bookingId),
});

/** PriceGuard's work after delivery: re-check this room's price until check-in. */
export const roomWatch = (q: StoredQuote): Watch | undefined =>
  q.hotelId
    ? {
        active: true,
        hotelId: q.hotelId,
        roomName: q.roomName,
        checkin: q.checkin,
        checkout: q.checkout,
        adults: q.adults,
        paid: q.total,
        currency: q.currency,
        checks: 0,
        rebooks: [],
      }
    : undefined;

export type HotelWorker = JobWorker<StoredQuote, Watch>;

export const hotelWorker = (
  d: {
    lite: LiteApiClient;
    watches?: boolean; // keeps watching the room's price after delivery (PriceGuard)
  } & Omit<ConstructorParameters<typeof JobWorker<StoredQuote, Watch>>[0], "supplier" | "watchFor">,
) =>
  new JobWorker<StoredQuote, Watch>({
    ...d,
    supplier: hotelSupplier(d.lite),
    watchFor: d.watches ? roomWatch : undefined,
  });
