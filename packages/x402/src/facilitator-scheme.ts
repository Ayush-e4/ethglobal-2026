import { type Account, createClient } from "@app/hedera";
import {
  hederaRpc,
  hederaTestnet,
  mandateRegistryAbi,
  revertName,
  tokenIdToEvmAddress,
} from "@app/mandates";
import { ContractExecuteTransaction, ContractId } from "@hiero-ledger/sdk";
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import {
  type Address,
  createPublicClient,
  encodeFunctionData,
  type Hex,
  hexToBytes,
  keccak256,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { HederaIds } from "./ids";
import {
  ATM,
  NETWORK,
  type TransferExecutorPayload,
  TransferExecutorPayloadSchema,
} from "./payload";
import { checkSettlement, type MirrorTransaction } from "./settlement-check";

/** We choose the gas, and simulate with exactly what we submit (a held payment uses ~200k). */
export const SETTLE_GAS = 400_000;

type Built = { p: TransferExecutorPayload; executor: Address; args: readonly unknown[]; data: Hex };

/**
 * Our facilitator for `transferExecutor` (the official packages don't implement it yet): checks
 * the payment by simulating the contract call, then submits it from the relayer and proves it
 * from the ledger. Only admitted contracts are ever called (default deny), and the call is built
 * from the requirements, never taken from the client.
 */
export class MandateFacilitatorScheme implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "hedera:*";
  private readonly inFlight = new Set<string>();
  private readonly reader = createPublicClient({ chain: hederaTestnet, transport: hederaRpc() });

  constructor(
    private readonly o: {
      relayer: Account; // pays the fees; signs only the wrapping ContractExecuteTransaction
      executors: readonly string[]; // admitted contracts (MandateRegistry's Hedera id)
      ids: HederaIds;
      network?: "testnet";
    },
  ) {}

  getExtra(): Record<string, unknown> {
    return { assetTransferMethods: [ATM], executors: [...this.o.executors] };
  }

  getSigners(): string[] {
    return [this.o.relayer.id];
  }

  async verify(payload: PaymentPayload, req: PaymentRequirements): Promise<VerifyResponse> {
    const built = await this.build(payload, req);
    if ("invalidReason" in built) return built;
    return { isValid: true, payer: built.p.payer };
  }

  async settle(payload: PaymentPayload, req: PaymentRequirements): Promise<SettleResponse> {
    const fail = (errorReason: string, errorMessage?: string, transaction = "") => ({
      success: false,
      errorReason,
      errorMessage,
      transaction,
      network: req.network as Network,
    });
    const built = await this.build(payload, req); // re-checks admission and simulates again
    if ("invalidReason" in built) return fail(built.invalidReason, built.invalidMessage);
    const key = keccak256(
      toHex(`${req.network}|${built.p.executor}|${built.p.payer}|${built.p.authorization}`),
    );
    if (this.inFlight.has(key))
      return fail("invalid_payload", "this payment is already being settled");
    this.inFlight.add(key);
    try {
      const client = createClient(this.o.network ?? "testnet", this.o.relayer);
      const tx = await new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(built.p.executor))
        .setGas(SETTLE_GAS)
        .setFunctionParameters(hexToBytes(built.data))
        .execute(client);
      const transaction = tx.transactionId.toString();
      try {
        await tx.getReceipt(client);
      } catch (e) {
        return fail("settlement_status_not_success", String(e), transaction);
      } finally {
        client.close();
      }
      const records = await this.records(transaction);
      if (!records) return fail("settlement_pending", "no record on the mirror yet", transaction);
      const bad = checkSettlement(records, {
        asset: req.asset,
        payer: built.p.payer,
        payTo: req.payTo,
        amount: BigInt(req.amount),
        feePayer: this.o.relayer.id,
      });
      if (bad) return fail(bad.code, bad.message, transaction);
      return { success: true, transaction, network: req.network as Network, payer: built.p.payer };
    } finally {
      this.inFlight.delete(key);
    }
  }

  /** Spec Phase 3: shape, method, admission, asset, addresses, then simulate the exact call. */
  private async build(
    payload: PaymentPayload,
    req: PaymentRequirements,
  ): Promise<Built | (VerifyResponse & { invalidReason: string })> {
    const no = (invalidReason: string, invalidMessage?: string) => ({
      isValid: false as const,
      invalidReason,
      invalidMessage,
    });
    if (req.network !== NETWORK) return no("invalid_network");
    if (req.extra?.assetTransferMethod !== ATM) {
      return no("invalid_exact_hedera_unsupported_asset_transfer_method");
    }
    const parsed = TransferExecutorPayloadSchema.safeParse(payload.payload);
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? "transfer_executor");
      return no(`invalid_exact_hedera_payload_${field}`);
    }
    const p = parsed.data;
    if (!this.o.executors.includes(p.executor))
      return no("invalid_exact_hedera_executor_not_admitted");
    if (!/^0\.0\.[1-9]\d*$/.test(req.asset))
      return no("invalid_payment_requirements", "HTS tokens only");
    if (await this.o.ids.hasCustomFees(req.asset))
      return no("invalid_exact_hedera_custom_fee_asset");

    let from: Address;
    let to: Address;
    let executor: Address;
    try {
      [from, to, executor] = await Promise.all([
        this.o.ids.evmAddress(p.payer),
        this.o.ids.evmAddress(req.payTo),
        this.o.ids.evmAddress(p.executor),
      ]);
    } catch (e) {
      return no("address_resolution_failed", String(e));
    }
    const args = [
      from,
      tokenIdToEvmAddress(req.asset),
      to,
      BigInt(req.amount),
      p.authorization as Hex,
    ] as const;
    try {
      await this.reader.simulateContract({
        account: privateKeyToAccount(`0x${this.o.relayer.key}`).address,
        address: executor,
        abi: mandateRegistryAbi,
        functionName: "executeTransfer",
        args,
        gas: BigInt(SETTLE_GAS),
      });
    } catch (e) {
      return no("simulation_reverted", revertName(e));
    }
    const data = encodeFunctionData({
      abi: mandateRegistryAbi,
      functionName: "executeTransfer",
      args,
    });
    return { p, executor, args, data };
  }

  /** The transaction and its child records (contract transfers live there), once indexed. */
  private async records(transactionId: string): Promise<MirrorTransaction[] | null> {
    const [account, time] = transactionId.split("@");
    const id = `${account}-${time?.replace(".", "-")}`;
    for (let i = 0; i < 20; i++) {
      const res = await fetch(`${this.o.ids.mirrorUrl}/api/v1/transactions/${id}`).catch(
        () => null,
      );
      if (res?.ok) {
        const { transactions } = (await res.json()) as { transactions: MirrorTransaction[] };
        if (transactions.length > 0) return transactions;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return null;
  }
}
