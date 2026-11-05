import type { Address } from "viem";

export { hederaTestnet } from "viem/chains";

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
