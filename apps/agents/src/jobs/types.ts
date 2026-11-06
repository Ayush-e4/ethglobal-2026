import type { Hex } from "viem";

/** Who a booking is for. Test travellers only. A flight also needs the date of birth and gender. */
export interface Guest {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  bornOn?: string; // YYYY-MM-DD
  gender?: "f" | "m";
}

export type JobStatus = "held" | "booking" | "delivered" | "refunded" | "cancelled" | "failed";

/** What a watching agent keeps doing after delivery (its own shape), and how to stop it. */
export interface WatchBase {
  active: boolean;
  note?: string;
}

/** One paid job, from the held payment to delivered (or refunded / cancelled). */
export interface PaidJob<W extends WatchBase = WatchBase> {
  escrowId: Hex;
  quoteKey: Hex;
  task: string;
  guest: Guest;
  status: JobStatus;
  bookingCancelled?: boolean; // the guest cancelled it after it was booked
  startsAt: number; // unix seconds: the undo window ends, work may start
  bookingId?: string; // the supplier's id for it (to cancel it)
  confirmation?: string;
  reference?: string; // what the guest quotes, when it isn't the booking id (an airline's code)
  deliveredTx?: string;
  refundTx?: string;
  note?: string;
  watch?: W; // a watching agent's, after delivery
}

/** A quote an agent stored when it offered it, as the paid-job code needs it. */
export interface QuoteBase {
  key: Hex;
  task: string;
  expiresAtMs: number;
}

/** Where the job is actually done: a hotel or an airline, through its API. */
export interface Supplier<Q> {
  book(
    quote: Q,
    guest: Guest,
    ref: string,
  ): Promise<{ bookingId: string; confirmation?: string; reference?: string }>;
  cancel(bookingId: string): Promise<unknown>;
}
