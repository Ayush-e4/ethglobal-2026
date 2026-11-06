import type { HotelGuest } from "@app/travel";
import type { Hex } from "viem";

/** A firm quote: the LiteAPI prebook it's built on, and its Arkiv record. */
export interface StoredQuote {
  key: Hex; // the Arkiv quote entity
  task: string;
  prebookId: string;
  hotelName: string;
  roomName: string;
  total: number; // the stay's price, paid to the hotel (simulated in the sandbox)
  currency: string;
  checkin: string;
  checkout: string;
  adults: number;
  refundable?: boolean;
  feeUnits: string; // StayWise's fee, in USDC units, held in escrow
  expiresAtMs: number;
  // What the buyer sees: why it's offered, and the hotel at a glance.
  tag?: string; // "Cheapest", "Best rated", "Best value"
  board?: string; // e.g. "Breakfast included"
  photos?: string[]; // https
  area?: string;
  address?: string;
  score?: number; // guests' score out of 10
  stars?: number;
  reviews?: number;
  facilities?: string[];
}

export type JobStatus = "held" | "booking" | "delivered" | "refunded" | "cancelled" | "failed";

/** One paid booking, from the held payment to delivered (or refunded / cancelled). */
export interface Job {
  escrowId: Hex;
  quoteKey: Hex;
  task: string;
  guest: HotelGuest;
  status: JobStatus;
  startsAt: number; // unix seconds: the undo window ends, work may start
  bookingId?: string;
  confirmation?: string;
  deliveredTx?: string;
  refundTx?: string;
  note?: string;
}
