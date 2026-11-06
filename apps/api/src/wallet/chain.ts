import {
  erc20Abi,
  hederaTestnet,
  type KeySig,
  type PasskeyKey,
  PasskeyWalletClient,
  type WalletCall,
} from "@app/mandates";
import { HederaIds } from "@app/x402";
import { type Address, createWalletClient, type Hex, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { WalletConfig } from "./config";

/** What the wallet service needs from Hedera (a fake in tests). */
export interface WalletChain {
  addressOf(k: PasskeyKey): Promise<Address>;
  create(k: PasskeyKey): Promise<Address>;
  hederaIdOf(wallet: Address): Promise<string | null>;
  gift(to: Address, units: bigint): Promise<Hex>;
  balanceOf(wallet: Address): Promise<bigint>;
  allowance(owner: Address, spender: Address): Promise<bigint>;
  digest(wallet: Address, calls: WalletCall[], deadline: bigint): Promise<Hex>;
  execute(
    wallet: Address,
    calls: WalletCall[],
    deadline: bigint,
    sig: KeySig,
    gas: bigint,
  ): Promise<{ hash: Hex; mandateId?: bigint }>;
}

/**
 * The real thing. The sponsor sends every transaction and pays its gas, and gives new wallets
 * their test USDC; it can't move anything a wallet holds.
 */
export function hederaWalletChain(cfg: WalletConfig): WalletChain {
  const sponsor = privateKeyToAccount(`0x${cfg.sponsor.key}`);
  const client = new PasskeyWalletClient(cfg.factory);
  const writer = createWalletClient({ account: sponsor, chain: hederaTestnet, transport: http() });
  return {
    addressOf: (k) => client.addressOf(k),
    create: (k) => client.create(sponsor, k, cfg.usdc),
    // A fresh lookup each time: a wallet the mirror hasn't indexed yet mustn't be cached as unknown.
    hederaIdOf: (wallet) => new HederaIds(cfg.mirrorUrl).idOf(wallet).catch(() => null),
    async gift(to, units) {
      const hash = await writer.writeContract({
        address: cfg.usdc,
        abi: erc20Abi,
        functionName: "transfer",
        args: [to, units],
      });
      const r = await client.publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error(`gift failed: ${hash}`);
      return hash;
    },
    balanceOf: (wallet) =>
      client.publicClient.readContract({
        address: cfg.usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet],
      }),
    allowance: (owner, spender) =>
      client.publicClient.readContract({
        address: cfg.usdc,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, spender],
      }),
    digest: (wallet, calls, deadline) => client.digest(wallet, calls, deadline),
    execute: (wallet, calls, deadline, sig, gas) =>
      client.execute(sponsor, wallet, calls, deadline, sig, gas),
  };
}
