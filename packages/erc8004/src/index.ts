import { hederaRpc, hederaTestnet } from "@app/mandates";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { identityRegistryAbi, reputationRegistryAbi } from "./abi";

export { identityRegistryAbi, reputationRegistryAbi };

/**
 * ERC-8004 ("Trustless Agents") on Hedera testnet: the official shared registries, the same
 * addresses on every testnet. An agent's identity is an NFT it owns, pointing at its agent card;
 * reputation is feedback from the clients that hired it.
 */
export const ERC8004 = {
  chainId: 296,
  identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address,
  reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address,
} as const;
/** How ERC-8004 names a registry: eip155:<chain>:<address>. */
export const agentRegistry = `eip155:${ERC8004.chainId}:${ERC8004.identity}`;
export const hashscanToken = (agentId: bigint | string) =>
  `https://hashscan.io/testnet/token/${ERC8004.identity}/${agentId}`;

/** An agent's registration file (its "agent card"), per ERC-8004's registration-v1. */
export function agentCard(a: {
  name: string;
  description: string;
  endpoint: string; // its API
  agentId?: bigint | string; // once registered
  arkivProfile?: string; // where the market lists it
}) {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: a.name,
    description: a.description,
    services: [
      { name: "web", endpoint: a.endpoint },
      ...(a.arkivProfile ? [{ name: "agentnet-listing", endpoint: a.arkivProfile }] : []),
    ],
    x402Support: true,
    active: true,
    registrations: a.agentId === undefined ? [] : [{ agentId: Number(a.agentId), agentRegistry }],
    supportedTrust: ["reputation"],
  };
}

/** One piece of feedback, as ERC-8004 records it: a value with decimals, two tags, a pointer. */
export interface Feedback {
  agentId: bigint;
  value: bigint; // e.g. 5 (stars), with decimals 0
  decimals: number;
  tag1: string;
  tag2: string;
  endpoint: string;
  feedbackURI: string; // where the full record is (e.g. the rating on Arkiv)
  feedbackHash: Hex; // keccak256 of that record
}

export class Erc8004Client {
  readonly publicClient: PublicClient;
  constructor(readonly chain = hederaTestnet) {
    this.publicClient = createPublicClient({ chain, transport: hederaRpc() }) as PublicClient;
  }

  tokenURI(agentId: bigint) {
    return this.publicClient.readContract({
      address: ERC8004.identity,
      abi: identityRegistryAbi,
      functionName: "tokenURI",
      args: [agentId],
    }) as Promise<string>;
  }

  ownerOf(agentId: bigint) {
    return this.publicClient.readContract({
      address: ERC8004.identity,
      abi: identityRegistryAbi,
      functionName: "ownerOf",
      args: [agentId],
    }) as Promise<Address>;
  }

  /** The agent registers itself (its own key owns the identity). Returns its agentId. */
  /**
   * The identity this address already registered, from Hedera's mirror node: its register
   * transactions and their Transfer from nobody to it. So a register that timed out while it
   * was being sent (Hashio can be slow) is found instead of registered twice. Null if none.
   */
  async registeredId(
    owner: Address,
    mirror = process.env.MIRROR_URL ?? "https://testnet.mirrornode.hedera.com",
  ): Promise<bigint | null> {
    const get = async <T>(path: string) =>
      (
        await fetch(`${mirror}${path}`, { signal: AbortSignal.timeout(15_000) })
      ).json() as Promise<T>;
    // Its calls to the registry (a reverted one has no Transfer, so it's skipped by itself).
    const sent = await get<{ results?: { hash: string }[] }>(
      `/api/v1/contracts/${ERC8004.identity}/results?from=${owner}&limit=25&order=asc`,
    );
    for (const r of sent.results ?? []) {
      const tx = await get<{ logs?: { topics: string[] }[] }>(
        `/api/v1/contracts/results/${r.hash}`,
      );
      for (const l of tx.logs ?? []) {
        const [sig, from, to, id] = l.topics;
        if (
          sig === TRANSFER &&
          from &&
          BigInt(from) === 0n &&
          to &&
          BigInt(to) === BigInt(owner) &&
          id
        )
          return BigInt(id);
      }
    }
    return null;
  }

  async register(agent: LocalAccount, agentURI: string): Promise<{ agentId: bigint; tx: Hex }> {
    const receipt = await this.write(agent, ERC8004.identity, identityRegistryAbi, "register", [
      agentURI,
    ]);
    const agentId = registeredId(receipt);
    if (agentId === null)
      throw new Error(`register: no Registered event in ${receipt.transactionHash}`);
    return { agentId, tx: receipt.transactionHash };
  }

  async setAgentURI(agent: LocalAccount, agentId: bigint, uri: string) {
    return (
      await this.write(agent, ERC8004.identity, identityRegistryAbi, "setAgentURI", [agentId, uri])
    ).transactionHash;
  }

  /**
   * A client gives feedback on an agent it hired (never the agent's own owner). Returns the
   * transaction once sent: a slow confirmation still counts as sent, so it's never sent twice.
   */
  async giveFeedback(client: LocalAccount, f: Feedback) {
    return (
      await this.write(
        client,
        ERC8004.reputation,
        reputationRegistryAbi,
        "giveFeedback",
        [f.agentId, f.value, f.decimals, f.tag1, f.tag2, f.endpoint, f.feedbackURI, f.feedbackHash],
        true,
      )
    ).transactionHash;
  }

  /** How many, and the average value, of the feedback these clients gave (with these tags). */
  async summary(agentId: bigint, clients: Address[], tag1 = "", tag2 = "") {
    const [count, value, decimals] = (await this.publicClient.readContract({
      address: ERC8004.reputation,
      abi: reputationRegistryAbi,
      functionName: "getSummary",
      args: [agentId, clients, tag1, tag2],
    })) as [bigint, bigint, number];
    return { count: Number(count), average: Number(value) / 10 ** decimals };
  }

  private async write(
    account: LocalAccount,
    address: Address,
    abi: typeof identityRegistryAbi | typeof reputationRegistryAbi,
    functionName: string,
    args: readonly unknown[],
    sentIsEnough = false, // a slow confirmation is fine: return the sent transaction
  ): Promise<Pick<TransactionReceipt, "transactionHash" | "logs">> {
    const { request } = await this.publicClient.simulateContract({
      account,
      address,
      abi,
      functionName,
      args,
    } as never);
    // Hedera charges at least 80% of the gas limit: the estimate plus a margin, not a guess.
    const estimate = await this.publicClient
      .estimateContractGas(request as never)
      .catch(() => BigInt(800_000));
    const gas = (estimate * BigInt(3)) / BigInt(2) + BigInt(50_000);
    const wallet = createWalletClient({ account, chain: this.chain, transport: hederaRpc() });
    const hash = await wallet.writeContract({ ...(request as object), gas } as never);
    const receipt = await this.publicClient
      .waitForTransactionReceipt({ hash, timeout: 180_000 })
      .catch((err) => {
        if (sentIsEnough) return null; // Hashio can be slow to confirm what Hedera already has
        throw err;
      });
    if (!receipt) return { transactionHash: hash, logs: [] };
    if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
    return receipt;
  }
}

/** ERC-721 Transfer(from, to, tokenId): minting an identity is a Transfer from address zero. */
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** The agentId from a register() receipt. */
export function registeredId(receipt: Pick<TransactionReceipt, "logs">): bigint | null {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ERC8004.identity.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: identityRegistryAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "Registered") return (ev.args as { agentId: bigint }).agentId;
    } catch {}
  }
  return null;
}
