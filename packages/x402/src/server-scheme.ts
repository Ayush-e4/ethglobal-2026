import type {
  AssetAmount,
  Network,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
  SupportedKind,
} from "@x402/core/types";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { ATM } from "./payload";

/**
 * The merchant's side of `transferExecutor`: quotes are paid through a contract the facilitator
 * admits. Settled before the route runs ("upfront"), so a held payment is in escrow before the
 * merchant starts work. Prices like "$0.02" become USDC units, as in the official Hedera scheme.
 */
export class MandateServerScheme implements SchemeNetworkServer {
  readonly scheme = "exact";
  readonly defaultAssetTransferMethod = ATM;
  readonly paymentFlows = {
    [ATM]: { supported: ["upfront"], default: "upfront" },
  } as const;
  private readonly prices = new ExactHederaScheme();

  /** @param executors the contracts this merchant accepts (narrows the facilitator's list). */
  constructor(private readonly executors?: readonly string[]) {}

  parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    return this.prices.parsePrice(price, network);
  }

  getAssetDecimals(asset: string, network: Network) {
    return this.prices.getAssetDecimals(asset, network);
  }

  async enhancePaymentRequirements(
    req: PaymentRequirements,
    kind: SupportedKind,
  ): Promise<PaymentRequirements> {
    const offered = Array.isArray(kind.extra?.executors) ? (kind.extra.executors as string[]) : [];
    const executors = this.executors ? offered.filter((e) => this.executors?.includes(e)) : offered;
    return { ...req, extra: { ...req.extra, assetTransferMethod: ATM, executors } };
  }
}
