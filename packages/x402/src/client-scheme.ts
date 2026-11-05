import {
  type EscrowAuth,
  encodeEscrowAuthorization,
  encodePaymentAuthorization,
  type MandateClient,
  type PaymentAuth,
  randomNonce,
  signEscrow,
  signPayment,
} from "@app/mandates";
import type {
  PaymentPayloadResult,
  PaymentRequirements,
  SchemeNetworkClient,
} from "@x402/core/types";
import { findDefaultAsset } from "@x402/hedera";
import type { Hex, LocalAccount } from "viem";
import type { HederaIds } from "./ids";
import { ATM, EscrowOfferSchema } from "./payload";

/** What the agent just signed, so the caller can follow a held payment. */
export interface SignedPayment {
  kind: "direct" | "held";
  mandateId: bigint;
  nonce: bigint;
  amount: bigint;
  payee: Hex;
  escrowId?: Hex;
}

export interface MandateClientOptions {
  agent: LocalAccount; // signs; never needs HBAR
  mandateId: bigint;
  owner: string; // the limit owner's Hedera id: whose money moves
  registry: MandateClient;
  ids: HederaIds;
  /** Refuse held payments whose undo window is shorter than this (the user's own rule). */
  minUndoSeconds?: number;
  onSigned?: (p: SignedPayment) => void;
}

/**
 * The paying side of `transferExecutor` with our spending-limit contract: the agent signs an
 * EIP-712 payment that only MandateRegistry can use, within the owner's limit. `payTo` = a
 * merchant pays now; `payTo` = the registry holds it, on the terms in `extra.escrow`.
 */
export class MandateClientScheme implements SchemeNetworkClient {
  readonly scheme = "exact";
  /** Lets the official client apply its own per-payment cap ($1 by default) on top of ours. */
  readonly findDefaultAsset = findDefaultAsset;

  constructor(private readonly o: MandateClientOptions) {}

  async createPaymentPayload(
    x402Version: number,
    req: PaymentRequirements,
  ): Promise<PaymentPayloadResult> {
    if (req.extra?.assetTransferMethod !== ATM) throw new Error(`not a ${ATM} payment`);
    const executor = await this.o.ids.idOf(this.o.registry.registry);
    const executors = Array.isArray(req.extra.executors) ? req.extra.executors : [];
    if (!executors.includes(executor)) throw new Error(`the merchant doesn't accept ${executor}`);

    const now = BigInt(Math.floor(Date.now() / 1000));
    const base = {
      mandateId: this.o.mandateId,
      amount: BigInt(req.amount),
      nonce: randomNonce(),
      validBefore: now + BigInt(req.maxTimeoutSeconds),
    };
    const payTo = await this.o.ids.evmAddress(req.payTo);
    let authorization: Hex;
    if (payTo === this.o.registry.registry.toLowerCase()) {
      const offer = EscrowOfferSchema.parse(req.extra.escrow);
      if (offer.undoSeconds < (this.o.minUndoSeconds ?? 0)) {
        throw new Error(`undo window ${offer.undoSeconds}s is shorter than allowed`);
      }
      const auth: EscrowAuth = {
        ...base,
        payTo: offer.payee as Hex,
        undoSeconds: offer.undoSeconds,
        deliverBy: now + BigInt(offer.undoSeconds + offer.deliverWithinSeconds),
        reviewSeconds: offer.reviewSeconds,
      };
      const sig = await signEscrow(this.o.agent, this.o.registry.domain(), auth);
      authorization = encodeEscrowAuthorization(auth, sig);
      const escrowId = await this.o.registry.escrowIdOf(base.mandateId, base.nonce);
      this.o.onSigned?.({ kind: "held", ...base, payee: auth.payTo, escrowId });
    } else {
      const auth: PaymentAuth = { ...base, payTo };
      const sig = await signPayment(this.o.agent, this.o.registry.domain(), auth);
      authorization = encodePaymentAuthorization(auth, sig);
      this.o.onSigned?.({ kind: "direct", ...base, payee: payTo });
    }
    return { x402Version, payload: { payer: this.o.owner, executor, authorization } };
  }
}
