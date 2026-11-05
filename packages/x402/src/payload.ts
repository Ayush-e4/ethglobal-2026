import { z } from "zod";

/** The network and the x402 method we use: pay through a contract (the spec's `transferExecutor`). */
export const NETWORK = "hedera:testnet";
export const ATM = "transferExecutor";

const HEDERA_ID = /^0\.0\.\d+$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** What a client sends for `transferExecutor` (spec Phase 2): nothing else crosses the wire. */
export const TransferExecutorPayloadSchema = z.object({
  payer: z.string().regex(HEDERA_ID), // whose money moves (the limit's owner)
  executor: z.string().regex(HEDERA_ID), // the contract that moves it (MandateRegistry)
  authorization: z.string().regex(/^0x([0-9a-fA-F]{2})*$/), // opaque to the facilitator
});
export type TransferExecutorPayload = z.infer<typeof TransferExecutorPayloadSchema>;

/**
 * A merchant offering pay on delivery puts this in `extra.escrow`, with `payTo` = the registry:
 * the money is held there, then reaches `payee` once delivered (MandateEscrow.sol).
 */
export const EscrowOfferSchema = z.object({
  payee: z.string().regex(ADDRESS), // the merchant's EVM address
  undoSeconds: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 3600),
  deliverWithinSeconds: z.number().int().positive(),
  reviewSeconds: z
    .number()
    .int()
    .min(0)
    .max(30 * 24 * 3600),
});
export type EscrowOffer = z.infer<typeof EscrowOfferSchema>;
