import { type Account, account, loadConfig as loadHedera, NETWORKS } from "@app/hedera";
import { tokenIdToEvmAddress, walletFactoryAddress } from "@app/mandates";
import { parseUsdc } from "@app/shared";
import { z } from "zod";

const Env = z.object({
  WALLET_GIFT_USDC: z.string().default("0.10"), // test USDC each new Face ID wallet starts with
  WALLET_GIFTS_PER_DAY: z.coerce.number().int().min(0).default(10), // across everyone
});

export interface WalletConfig {
  sponsor: Account; // makes wallets and submits their signed batches, paying the gas
  factory: `0x${string}`;
  usdc: `0x${string}`;
  mirrorUrl: string;
  giftUnits: bigint;
  giftsPerDay: number;
}

export function loadWalletConfig(
  env: Record<string, string | undefined> = process.env,
): WalletConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Wallet settings:\n  ${fields.join("\n  ")}`);
  }
  const hedera = loadHedera(env);
  const net = NETWORKS[hedera.network];
  return {
    sponsor: account(hedera, "sponsor"),
    factory: walletFactoryAddress(env),
    usdc: tokenIdToEvmAddress(env.USDC_TOKEN_ID || net.usdcTokenId),
    mirrorUrl: net.mirrorUrl,
    giftUnits: parseUsdc(parsed.data.WALLET_GIFT_USDC),
    giftsPerDay: parsed.data.WALLET_GIFTS_PER_DAY,
  };
}
