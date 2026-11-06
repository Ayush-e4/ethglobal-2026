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
  refundable: boolean;
  changeable: boolean;
  emissionsKg?: number;
  feeUnits: string; // the agent's fee, in USDC units, held in escrow
  expiresAtMs: number;
  tag: string; // "Cheapest", "Fastest", "Most flexible"
}

export type FlightJob = PaidJob;
