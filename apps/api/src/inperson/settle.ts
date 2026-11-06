import type { MandateClient } from "@app/mandates";
import { ATM, type HederaIds, MandateClientScheme, NETWORK } from "@app/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { PaymentRequirements } from "@x402/core/types";
import type { LocalAccount } from "viem";
import { PayError } from "../hiring/pay";

/**
 * Pays a merchant in person: the same x402 payment our agents get, settled by our facilitator
 * on Hedera through MandateRegistry, within the payer's limit. There's no paywall to ask, so the
 * terms are ours: exactly `units` of test USDC, straight to the merchant's account (no escrow:
 * they hand over the chai). Returns the Hedera transaction id.
 */
export async function payMerchant(d: {
  registry: MandateClient;
  ids: HederaIds;
  concierge: LocalAccount;
  mandateId: bigint;
  ownerAccount: string;
  facilitatorUrl: string;
  payTo: string; // 0.0.<n>
  payee: `0x${string}`; // the same shop's wallet (EVM): the key pays nobody else
  units: bigint;
}) {
  const accepted: PaymentRequirements = {
    scheme: "exact",
    network: NETWORK,
    asset: process.env.USDC_TOKEN_ID || "0.0.429274",
    amount: d.units.toString(),
    payTo: d.payTo,
    maxTimeoutSeconds: 120,
    extra: { assetTransferMethod: ATM, executors: [await d.ids.idOf(d.registry.registry)] },
  };
  const scheme = new MandateClientScheme({
    expect: { maxAmount: d.units, payee: d.payee },
    agent: d.concierge,
    mandateId: d.mandateId,
    owner: d.ownerAccount,
    registry: d.registry,
    ids: d.ids,
  });
  const signed = await scheme.createPaymentPayload(2, accepted);
  const settled = await new HTTPFacilitatorClient({ url: d.facilitatorUrl }).settle(
    {
      x402Version: 2,
      resource: { url: "https://shikigami.app/pay-in-person", description: "Paid in person" },
      accepted,
      payload: signed.payload,
    },
    accepted,
  );
  if (!settled.success || !settled.transaction)
    throw new PayError(settled.errorMessage ?? settled.errorReason ?? "refused");
  return settled.transaction;
}
