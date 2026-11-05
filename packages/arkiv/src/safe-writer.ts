import { createWalletClient } from "@arkiv-network/sdk";
import { createPublicClient, custom, type Hex, parseEther, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARKIV_CHAIN, arkivTransport } from "./config";

/**
 * Arkiv's write rules for Rabdi (guides/known-issues): gas estimates can be too low, so every
 * signature gets gas >= max(1,000,000 + 400,000 × (N - 1), 2 × estimate) for N operations, never
 * more than half a block; an explicit nonce and gas price read at latest; no automatic retries
 * (a resend could land twice); a receipt with status success. The RPC URL carries the access key,
 * so errors leave here as fixed codes, never provider text.
 */
export function policyGas(estimate: bigint, ops: number): bigint {
  const floor = BigInt(1_000_000) + BigInt(400_000) * BigInt(Math.max(0, ops - 1));
  const twice = estimate * BigInt(2);
  return twice > floor ? twice : floor;
}

export class ArkivWriteError extends Error {
  constructor(
    readonly code:
      | "gas_over_half_block"
      | "over_fee_budget"
      | "insufficient_funds"
      | "write_failed"
      | "receipt_not_success",
    readonly txHash?: Hex,
  ) {
    super(`Arkiv write ${code}${txHash ? ` (${txHash})` : ""}`);
  }
}

type Tx = { nonce: number; gasPrice: bigint };

/** One wallet's writes, one at a time (explicit nonces), each within a fee budget. */
export class SafeArkivWriter {
  readonly address: Hex;
  // Plain EVM reads (nonce, gas price, balance, receipts) on the same keyed endpoint.
  private readonly reader = createPublicClient({ chain: ARKIV_CHAIN, transport: arkivTransport() });
  private queue: Promise<unknown> = Promise.resolve();
  private current = { ops: 1, gasPrice: BigInt(1) };
  readonly client;

  constructor(
    privateKey: Hex,
    private readonly maxFeeWei = parseEther("0.05"),
  ) {
    const account = privateKeyToAccount(privateKey);
    this.address = account.address;
    const base = arkivTransport()({ chain: ARKIV_CHAIN });
    // The SDK asks for an estimate and adds 25%; we answer with the policy's gas instead, so the
    // signed limit is always at least what the rules require.
    const transport = custom(
      {
        request: async ({ method, params }) => {
          if (method !== "eth_estimateGas") return base.request({ method, params });
          const estimate = BigInt((await base.request({ method, params })) as Hex);
          const gas = policyGas(estimate, this.current.ops);
          const signed = (gas * BigInt(125)) / BigInt(100);
          const head = await this.reader.getBlock({ blockTag: "latest" });
          if (signed * BigInt(2) > head.gasLimit) throw new ArkivWriteError("gas_over_half_block");
          const fee = signed * this.current.gasPrice;
          if (fee > this.maxFeeWei) throw new ArkivWriteError("over_fee_budget");
          const balance = await this.reader.getBalance({
            address: this.address,
            blockTag: "latest",
          });
          if (balance < fee) throw new ArkivWriteError("insufficient_funds");
          return toHex(gas);
        },
      },
      { retryCount: 0 },
    );
    this.client = createWalletClient({ chain: ARKIV_CHAIN, transport, account });
  }

  /** Runs one signed write of `ops` operations after the ones already queued. */
  run<T extends { txHash: Hex }>(ops: number, write: (tx: Tx) => Promise<T>): Promise<T> {
    const job = this.queue.then(async () => {
      const [nonce, gasPrice] = await Promise.all([
        this.reader.getTransactionCount({ address: this.address, blockTag: "latest" }),
        this.reader.getGasPrice(),
      ]);
      this.current = { ops, gasPrice };
      let result: T;
      try {
        result = await write({ nonce, gasPrice });
      } catch (e) {
        if (e instanceof ArkivWriteError) throw e;
        const txHash = (e as { txHash?: Hex }).txHash;
        throw new ArkivWriteError("write_failed", txHash);
      }
      const receipt = await this.reader
        .getTransactionReceipt({ hash: result.txHash })
        .catch(() => null);
      if (receipt?.status !== "success")
        throw new ArkivWriteError("receipt_not_success", result.txHash);
      return result;
    });
    this.queue = job.catch(() => undefined);
    return job;
  }
}
