import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { http } from "viem";

/** Every schema name starts with this, so our data never mixes with other apps on Arkiv. */
export const PROJECT = "ethglobal-2026";

/**
 * Rabdi, Arkiv's testnet. The access key (hub.arkiv.network) rides inside the RPC URL, so that
 * URL is a secret: never log it, and never pass provider errors through (they can contain it).
 */
export const ARKIV_CHAIN = rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" });
export const ARKIV_EXPLORER = {
  tx: (hash: string) => `https://rabdi.explorer.arkiv.network/tx/${hash}`,
  entity: (key: string) => `https://rabdi.explorer.arkiv.network/entity/${key}`,
} as const;

/** No automatic retries: a resent write could land twice. */
export const arkivTransport = () => http(undefined, { retryCount: 0, timeout: 15_000 });

export function arkivReader() {
  return createPublicClient({ chain: ARKIV_CHAIN, transport: arkivTransport() });
}

export type ArkivReader = ReturnType<typeof arkivReader>;
