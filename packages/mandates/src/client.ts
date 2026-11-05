import {
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  type Hex,
  http,
  type LocalAccount,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { ESCROW_STATES, erc20Abi, mandateRegistryAbi } from "./abi";
import { hederaTestnet } from "./chain";
import { type EscrowAuth, mandateDomain, type PaymentAuth, type SubMandateAuth } from "./signing";

export interface MandateParams {
  agent: Address;
  token: Address;
  budget: bigint;
  perPaymentCap: bigint;
  expiresAt: bigint;
  payees: readonly Address[];
}

type Write =
  | "createMandate"
  | "createSubMandate"
  | "pay"
  | "payIntoEscrow"
  | "revoke"
  | "cancel"
  | "markDelivered"
  | "release"
  | "claim"
  | "dispute"
  | "refund"
  | "reclaim"
  | "associate";

/**
 * A typed wrapper around a deployed MandateRegistry. Every write is simulated first, so a rule
 * the contract would refuse comes back as its error name (e.g. "OverBudget"), with no fee paid.
 * Whoever sends a write pays its network fee; for agent-signed payments that can be anyone
 * (our relayer), since the agent's signature is what authorises them.
 */
export class MandateClient {
  readonly publicClient: PublicClient;
  readonly chain = hederaTestnet;

  constructor(readonly registry: Address) {
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(),
    }) as PublicClient;
  }

  domain() {
    return mandateDomain(this.chain.id, this.registry);
  }

  // Reads

  getMandate(id: bigint) {
    return this.read("getMandate", [id]);
  }

  remaining(id: bigint) {
    return this.read("remaining", [id]) as Promise<bigint>;
  }

  isActive(id: bigint) {
    return this.read("isActive", [id]) as Promise<boolean>;
  }

  escrowIdOf(mandateId: bigint, nonce: bigint) {
    return this.read("escrowIdOf", [mandateId, nonce]) as Promise<Hex>;
  }

  async getEscrow(id: Hex) {
    const e = (await this.read("getEscrow", [id])) as {
      mandateId: bigint;
      payee: Address;
      startsAt: bigint;
      deliverBy: bigint;
      reviewSeconds: number;
      amount: bigint;
      deliveredAt: bigint;
      state: number;
      resultHash: Hex;
    };
    return { ...e, state: ESCROW_STATES[e.state] ?? "none" };
  }

  allowance(token: Address, owner: Address) {
    return this.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, this.registry],
    });
  }

  // Writes

  /** The owner lets the registry pull up to `amount` of `token` (only for allowed payments). */
  async approve(owner: LocalAccount, token: Address, amount: bigint) {
    const wallet = createWalletClient({ account: owner, chain: this.chain, transport: http() });
    const hash = await wallet.writeContract({
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [this.registry, amount],
      gas: BigInt(1_000_000), // the HTS token's ERC-20 facade needs more than estimated
    });
    return this.receipt(hash, "approve");
  }

  async createMandate(owner: LocalAccount, p: MandateParams) {
    const receipt = await this.write(owner, "createMandate", [{ ...p, payees: [...p.payees] }]);
    return { id: this.created(receipt), receipt };
  }

  async createSubMandate(
    sender: LocalAccount,
    auth: SubMandateAuth,
    payees: readonly Address[],
    signature: Hex,
  ) {
    const receipt = await this.write(sender, "createSubMandate", [auth, [...payees], signature]);
    return { id: this.created(receipt), receipt };
  }

  pay(sender: LocalAccount, auth: PaymentAuth, signature: Hex) {
    return this.write(sender, "pay", [auth, signature]);
  }

  async payIntoEscrow(sender: LocalAccount, auth: EscrowAuth, signature: Hex) {
    const receipt = await this.write(sender, "payIntoEscrow", [auth, signature]);
    return { id: await this.escrowIdOf(auth.mandateId, auth.nonce), receipt };
  }

  revoke = (sender: LocalAccount, id: bigint) => this.write(sender, "revoke", [id]);
  cancel = (buyer: LocalAccount, id: Hex) => this.write(buyer, "cancel", [id]);
  markDelivered = (payee: LocalAccount, id: Hex, resultHash: Hex) =>
    this.write(payee, "markDelivered", [id, resultHash]);
  release = (buyer: LocalAccount, id: Hex) => this.write(buyer, "release", [id]);
  claim = (sender: LocalAccount, id: Hex) => this.write(sender, "claim", [id]);
  dispute = (buyer: LocalAccount, id: Hex) => this.write(buyer, "dispute", [id]);
  refund = (payee: LocalAccount, id: Hex) => this.write(payee, "refund", [id]);
  reclaim = (sender: LocalAccount, id: Hex) => this.write(sender, "reclaim", [id]);
  /** Hedera: lets the registry hold `token`, which escrow needs. Once per token. */
  associate = (sender: LocalAccount, token: Address) => this.write(sender, "associate", [token]);

  /** Dry-runs a write. Returns the contract's error name, or null if it would succeed. */
  async check(sender: Address, functionName: Write, args: readonly unknown[]) {
    try {
      await this.simulate(sender, functionName, args);
      return null;
    } catch (err) {
      return revertName(err);
    }
  }

  private read(functionName: string, args: readonly unknown[]) {
    return this.publicClient.readContract({
      address: this.registry,
      abi: mandateRegistryAbi,
      functionName,
      args,
    } as never) as Promise<unknown>;
  }

  private simulate(account: Address | LocalAccount, functionName: Write, args: readonly unknown[]) {
    return this.publicClient.simulateContract({
      account,
      address: this.registry,
      abi: mandateRegistryAbi,
      functionName,
      args,
    } as never);
  }

  private async write(account: LocalAccount, functionName: Write, args: readonly unknown[]) {
    const { request } = await this.simulate(account, functionName, args);
    // Hedera charges at least 80% of the gas limit, so the limit is the estimate plus a margin
    // (token transfers inside the contract go through HTS, which estimates low).
    const estimate = await this.publicClient
      .estimateContractGas(request as never)
      .catch(() => BigInt(1_000_000));
    const gas = (estimate * BigInt(3)) / BigInt(2) + BigInt(50_000);
    const wallet = createWalletClient({ account, chain: this.chain, transport: http() });
    return this.receipt(
      await wallet.writeContract({ ...(request as object), gas } as never),
      functionName,
    );
  }

  private async receipt(hash: Hex, what: string): Promise<TransactionReceipt> {
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${what} reverted: ${hash}`);
    return receipt;
  }

  /** After `markDelivered`: when Hedera will pay the merchant by itself, if it scheduled it. */
  payoutSchedule(receipt: TransactionReceipt): { schedule: Address; at: bigint } | null {
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: mandateRegistryAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "PayoutScheduled")
          return { schedule: ev.args.schedule, at: ev.args.at };
      } catch {}
    }
    return null;
  }

  private created(receipt: TransactionReceipt): bigint {
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: mandateRegistryAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "MandateCreated") return ev.args.id;
      } catch {}
    }
    throw new Error("no MandateCreated event");
  }
}

/** The custom error name (e.g. "OverBudget") inside a viem error. */
export function revertName(err: unknown): string {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.data?.errorName ?? reverted.reason ?? "Reverted";
    }
    return err.shortMessage;
  }
  return String(err);
}
