import {
  type Address,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  keccak256,
  type LocalAccount,
  type PublicClient,
  parseAbi,
  parseEventLogs,
} from "viem";
import { erc20Abi, mandateRegistryAbi } from "./abi";
import { hederaRpc, hederaTestnet } from "./chain";
import type { MandateParams } from "./client";

/** PasskeyWallet: any of its passkeys (one per device) signs; a batch it signed adds or removes one. */
export const passkeyWalletAbi = parseAbi([
  "struct Call { address to; uint256 value; bytes data; }",
  "struct Assertion { bytes32 r; bytes32 s; uint256 challengeIndex; uint256 typeIndex; bytes authenticatorData; string clientDataJSON; }",
  "struct KeySig { bytes32 qx; bytes32 qy; Assertion sig; }",
  "function digest(Call[] calls, uint256 deadline) view returns (bytes32)",
  "function execute(Call[] calls, uint256 deadline, KeySig k)",
  "function addKey(bytes32 qx, bytes32 qy)",
  "function removeKey(bytes32 qx, bytes32 qy)",
  "function keyId(bytes32 qx, bytes32 qy) pure returns (bytes32)",
  "function isKey(bytes32 id) view returns (bool)",
  "function keyCount() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
  "event Executed(uint256 indexed nonce, bytes32 digest)",
  "event KeyAdded(bytes32 qx, bytes32 qy)",
  "event KeyRemoved(bytes32 qx, bytes32 qy)",
  "error Expired()",
  "error NotAKey()",
  "error BadSignature()",
  "error CallFailed(uint256 index, bytes reason)",
  "error OnlySelf()",
  "error LastKey()",
]);
export const passkeyWalletFactoryAbi = parseAbi([
  "function create(bytes32 qx, bytes32 qy, address token) returns (address wallet)",
  "function addressOf(bytes32 qx, bytes32 qy) view returns (address)",
  "event WalletCreated(address indexed wallet, bytes32 qx, bytes32 qy)",
]);

export type WalletCall = { to: Address; value: bigint; data: Hex };
export type PasskeyKey = { qx: Hex; qy: Hex };
export type Assertion = {
  r: Hex;
  s: Hex;
  challengeIndex: bigint;
  typeIndex: bigint;
  authenticatorData: Hex;
  clientDataJSON: string;
};
/** Which of the wallet's passkeys signed, with its answer. */
export type KeySig = PasskeyKey & { sig: Assertion };

const N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const fromB64url = (s: string) => Buffer.from(s, "base64url");
const word = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

/**
 * A browser's passkey answer (the base64url fields of `startAuthentication`'s response) in the
 * shape the wallet checks: r and s out of the DER signature (s flipped low, as the contract
 * requires), and where "type" and "challenge" sit in the client JSON.
 */
export function assertionFromWebAuthn(r: {
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}): Assertion {
  const der = fromB64url(r.signature);
  const rLen = der[3] ?? 0;
  const rBytes = der.subarray(4, 4 + rLen);
  const sBytes = der.subarray(6 + rLen, 6 + rLen + (der[5 + rLen] ?? 0));
  const int = (b: Uint8Array) => BigInt(`0x${Buffer.from(b).toString("hex") || "0"}`);
  let s = int(sBytes);
  if (s > N / BigInt(2)) s = N - s;
  const client = fromB64url(r.clientDataJSON).toString("utf8");
  return {
    r: word(int(rBytes)),
    s: word(s),
    challengeIndex: BigInt(client.indexOf('"challenge":"')),
    typeIndex: BigInt(client.indexOf('"type":"webauthn.get"')),
    authenticatorData: `0x${fromB64url(r.authenticatorData).toString("hex")}`,
    clientDataJSON: client,
  };
}

const call = (to: Address, data: Hex): WalletCall => ({ to, value: BigInt(0), data });

/**
 * The batch that sets a spending limit: let the registry pull up to the budget, then create it.
 * `allowance` is what the registry may already pull for the wallet's other limits: it's added
 * to, not replaced, so a new limit never starves an older one.
 */
export function limitCalls(registry: Address, p: MandateParams, allowance = BigInt(0)) {
  return [
    call(
      p.token,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [registry, allowance + p.budget],
      }),
    ),
    call(
      registry,
      encodeFunctionData({ abi: mandateRegistryAbi, functionName: "createMandate", args: [p] }),
    ),
  ];
}

/** The batch that cancels a spending limit. */
export const revokeCalls = (registry: Address, id: bigint) => [
  call(
    registry,
    encodeFunctionData({ abi: mandateRegistryAbi, functionName: "revoke", args: [id] }),
  ),
];

/** The batch that lets another device's passkey use the wallet. */
export const addKeyCalls = (wallet: Address, k: PasskeyKey) => [
  call(
    wallet,
    encodeFunctionData({ abi: passkeyWalletAbi, functionName: "addKey", args: [k.qx, k.qy] }),
  ),
];

/** The batch that shuts a device's passkey out (a lost phone). Never the last one. */
export const removeKeyCalls = (wallet: Address, k: PasskeyKey) => [
  call(
    wallet,
    encodeFunctionData({ abi: passkeyWalletAbi, functionName: "removeKey", args: [k.qx, k.qy] }),
  ),
];

/**
 * Passkey wallets from the outside: where a passkey's wallet is, making it, and running a batch
 * one of its passkeys signed. Whoever sends (our server) pays the gas; only the passkeys decide.
 */
export class PasskeyWalletClient {
  readonly publicClient: PublicClient;

  constructor(
    readonly factory: Address,
    readonly chain = hederaTestnet,
  ) {
    this.publicClient = createPublicClient({ chain, transport: hederaRpc() }) as PublicClient;
  }

  private writer = (sender: LocalAccount) =>
    createWalletClient({ account: sender, chain: this.chain, transport: hederaRpc() });

  addressOf = (k: PasskeyKey) =>
    this.publicClient.readContract({
      address: this.factory,
      abi: passkeyWalletFactoryAbi,
      functionName: "addressOf",
      args: [k.qx, k.qy],
    });

  /** Makes the passkey's wallet (once) and opts it in to `token`. Returns its address. */
  async create(sender: LocalAccount, k: PasskeyKey, token: Address): Promise<Address> {
    const wallet = await this.addressOf(k);
    const code = await this.publicClient.getCode({ address: wallet });
    if (code && code !== "0x") return wallet;
    const hash = await this.writer(sender).writeContract({
      address: this.factory,
      abi: passkeyWalletFactoryAbi,
      functionName: "create",
      args: [k.qx, k.qy, token],
      gas: BigInt(3_000_000),
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`creating the wallet failed: ${hash}`);
    for (let i = 0; i < 20; i++) {
      const made = await this.publicClient.getCode({ address: wallet }).catch(() => undefined);
      if (made && made !== "0x") break; // reads see it too (they lag the receipt a moment)
      await new Promise((r) => setTimeout(r, 1000));
    }
    return wallet;
  }

  /** Whether this passkey may sign for the wallet. */
  hasKey = (wallet: Address, k: PasskeyKey) =>
    this.publicClient.readContract({
      address: wallet,
      abi: passkeyWalletAbi,
      functionName: "isKey",
      args: [
        keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [k.qx, k.qy])),
      ],
    });

  /** What a passkey signs (the WebAuthn challenge) to run `calls` before `deadline`. */
  digest = (wallet: Address, calls: WalletCall[], deadline: bigint) =>
    this.publicClient.readContract({
      address: wallet,
      abi: passkeyWalletAbi,
      functionName: "digest",
      args: [calls, deadline],
    });

  /**
   * Runs a signed batch. Simulated first, so a bad signature fails with its error's name and
   * costs nothing. Returns the limit it created, if it created one.
   */
  async execute(
    sender: LocalAccount,
    wallet: Address,
    calls: WalletCall[],
    deadline: bigint,
    sig: KeySig,
    gas = BigInt(2_000_000), // setting a limit used 1.2M on Hedera (approve through HTS is dear)
  ) {
    const { request } = await this.publicClient.simulateContract({
      account: sender,
      address: wallet,
      abi: [...passkeyWalletAbi, ...mandateRegistryAbi],
      functionName: "execute",
      args: [calls, deadline, sig],
      gas,
    });
    const hash = await this.writer(sender).writeContract(request);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`the wallet's batch failed: ${hash}`);
    // Hedera's JSON-RPC reads lag the receipt by a moment. Wait until they show the nonce used
    // up, so the next batch's digest (which includes the nonce) isn't signed over a stale one.
    const [ran] = parseEventLogs({
      abi: passkeyWalletAbi,
      logs: receipt.logs,
      eventName: "Executed",
    });
    for (let i = 0; ran && i < 20; i++) {
      const nonce = await this.publicClient
        .readContract({ address: wallet, abi: passkeyWalletAbi, functionName: "nonce" })
        .catch(() => BigInt(0));
      if (nonce > ran.args.nonce) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const created = parseEventLogs({
      abi: mandateRegistryAbi,
      logs: receipt.logs,
      eventName: "MandateCreated",
    })[0];
    return { hash, mandateId: created?.args.id };
  }
}
