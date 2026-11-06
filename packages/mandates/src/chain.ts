import { type Address, defineChain, http } from "viem";
import { getGasPrice } from "viem/actions";
import { hederaTestnet as viemHederaTestnet } from "viem/chains";

const TINYBARS_TO_WEI = BigInt(10_000_000_000); // Hedera's JSON-RPC prices gas in "weibars"

/**
 * Hedera testnet, pricing gas from eth_gasPrice. Hashio now and then reports a block's base fee
 * in tinybars (126 instead of 1.26e12), and a transaction priced from it is refused as below the
 * network's minimum gas price. So: eth_gasPrice, scaled up if it comes back in tinybars too,
 * plus 20% headroom (Hedera charges the network price, not the cap).
 */
export const hederaTestnet = defineChain({
  ...viemHederaTestnet,
  fees: {
    async estimateFeesPerGas({ client, type }) {
      let price = await getGasPrice(client);
      if (price < BigInt(1_000_000_000)) price *= TINYBARS_TO_WEI;
      const capped = (price * BigInt(12)) / BigInt(10);
      return type === "legacy"
        ? { gasPrice: capped }
        : { maxFeePerGas: capped, maxPriorityFeePerGas: BigInt(0) };
    },
  },
});

const env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env;

/** Where the registry lives: set by `pnpm --filter @app/mandates deploy-registry` in .env. */
export function registryAddress(e: Record<string, string | undefined> = env): Address {
  const a = e.MANDATE_REGISTRY_ADDRESS;
  if (!a || !/^0x[0-9a-fA-F]{40}$/.test(a)) {
    throw new Error(
      "MANDATE_REGISTRY_ADDRESS isn't set: run pnpm --filter @app/mandates deploy-registry",
    );
  }
  return a as Address;
}

/** HTS token id ("0.0.429274") → its ERC-20 address ("0x…068cda"). */
export function tokenIdToEvmAddress(tokenId: string): Address {
  const num = Number(tokenId.split(".")[2]);
  if (!Number.isInteger(num)) throw new Error(`Bad token id: ${tokenId}`);
  return `0x${num.toString(16).padStart(40, "0")}`;
}

/** Where the passkey wallet factory lives: set by `pnpm --filter @app/mandates deploy-wallets`. */
export function walletFactoryAddress(e: Record<string, string | undefined> = env): Address {
  const a = e.PASSKEY_WALLET_FACTORY_ADDRESS;
  if (!a || !/^0x[0-9a-fA-F]{40}$/.test(a)) {
    throw new Error(
      "PASSKEY_WALLET_FACTORY_ADDRESS isn't set: run pnpm --filter @app/mandates deploy-wallets",
    );
  }
  return a as Address;
}

/**
 * How we reach Hedera's JSON-RPC (Hashio): 30 s before giving up (viem's 10 s default cut off
 * slow but successful calls) and a few retries with backoff for timeouts and 5xx. A resent
 * transaction is the same signed bytes, so it can't be paid twice.
 */
export const hederaRpc = () => http(undefined, { timeout: 30_000, retryCount: 4, retryDelay: 400 });
