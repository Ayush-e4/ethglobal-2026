import type { FlightLeg } from "@app/travel";
import type { Hex } from "viem";
import type { PaidJob } from "../jobs/types";

/** A flight offered: the Duffel offer it's built on, and its Arkiv record. */
export interface FlightQuote {
  key: Hex; // the Arkiv quote entity
  task: string;
  offerId: string;
  airline: string;
  legs: FlightLeg[];
  total: number; // the fare, paid to the airline (from Duffel's test balance)
  currency: string;
  inr?: number; // the same fare in rupees at today's rate, for showing it
  refundable: boolean;
  changeable: boolean;
  emissionsKg?: number;
  feeUnits: string; // the agent's fee, in USDC units, held in escrow
  priceUnits?: string; // the fare, held in escrow too (testnet scale, from the rupee price)
  expiresAtMs: number;
  tag: string; // "Cheapest", "Fastest", "Most flexible"
}

export type FlightJob = PaidJob;
