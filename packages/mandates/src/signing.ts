import {
  type Address,
  encodeAbiParameters,
  encodePacked,
  type Hex,
  keccak256,
  type LocalAccount,
} from "viem";

/** EIP-712 domain: must match `EIP712("MandateRegistry", "1")` in the contract. */
export function mandateDomain(chainId: number, registry: Address) {
  return { name: "MandateRegistry", version: "1", chainId, verifyingContract: registry } as const;
}

export interface PaymentAuth {
  mandateId: bigint;
  payTo: Address;
  amount: bigint;
  nonce: bigint;
  validBefore: bigint; // unix seconds
}

/** A payment held in escrow: an undo window, then until delivered (MandateEscrow.sol). */
export interface EscrowAuth extends PaymentAuth {
  undoSeconds: number;
  deliverBy: bigint; // unix seconds, after the undo window
  reviewSeconds: number;
}

export interface SubMandateAuth {
  parentId: bigint;
  agent: Address;
  budget: bigint;
  perPaymentCap: bigint;
  expiresAt: bigint;
  payeesHash: Hex;
  nonce: bigint;
  validBefore: bigint;
}

const paymentAuthTypes = {
  PaymentAuth: [
    { name: "mandateId", type: "uint256" },
    { name: "payTo", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "validBefore", type: "uint256" },
  ],
} as const;

const escrowAuthTypes = {
  EscrowAuth: [
    { name: "mandateId", type: "uint256" },
    { name: "payTo", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "undoSeconds", type: "uint32" },
    { name: "deliverBy", type: "uint64" },
    { name: "reviewSeconds", type: "uint32" },
  ],
} as const;

const subMandateAuthTypes = {
  SubMandateAuth: [
    { name: "parentId", type: "uint256" },
    { name: "agent", type: "address" },
    { name: "budget", type: "uint128" },
    { name: "perPaymentCap", type: "uint128" },
    { name: "expiresAt", type: "uint64" },
    { name: "payeesHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "validBefore", type: "uint256" },
  ],
} as const;

type Domain = ReturnType<typeof mandateDomain>;

export const signPayment = (agent: LocalAccount, domain: Domain, message: PaymentAuth) =>
  agent.signTypedData({ domain, types: paymentAuthTypes, primaryType: "PaymentAuth", message });

export const signEscrow = (agent: LocalAccount, domain: Domain, message: EscrowAuth) =>
  agent.signTypedData({ domain, types: escrowAuthTypes, primaryType: "EscrowAuth", message });

export const signSubMandate = (agent: LocalAccount, domain: Domain, message: SubMandateAuth) =>
  agent.signTypedData({
    domain,
    types: subMandateAuthTypes,
    primaryType: "SubMandateAuth",
    message,
  });

/** keccak256(abi.encodePacked(payees)), as SubMandateAuth.payeesHash. */
export const payeesHash = (payees: readonly Address[]) =>
  keccak256(encodePacked(["address[]"], [[...payees]]));

/** A random nonce: each signed payment works once. */
export function randomNonce(): bigint {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return BigInt(`0x${Buffer.from(b).toString("hex")}`);
}

/** x402 `authorization` for `executeTransfer`: abi.encode(mandateId, nonce, validBefore, sig). */
export const encodePaymentAuthorization = (a: PaymentAuth, signature: Hex) =>
  encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }],
    [a.mandateId, a.nonce, a.validBefore, signature],
  );

/** x402 `authorization` for `executeEscrowTransfer`: abi.encode(EscrowTerms, sig). */
export const encodeEscrowAuthorization = (a: EscrowAuth, signature: Hex) =>
  encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "mandateId", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "undoSeconds", type: "uint32" },
          { name: "deliverBy", type: "uint64" },
          { name: "reviewSeconds", type: "uint32" },
        ],
      },
      { type: "bytes" },
    ],
    [a, signature],
  );
