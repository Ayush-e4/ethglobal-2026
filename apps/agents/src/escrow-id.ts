import { decodePaymentSignatureHeader } from "@x402/core/http";
import { decodeAbiParameters, encodeAbiParameters, type Hex, keccak256 } from "viem";

/**
 * The escrow a paid request created, read from its PAYMENT-SIGNATURE header: the registry names
 * each escrow keccak256(abi.encode(mandateId, nonce)), both inside the signed terms.
 */
export function escrowIdFromHeader(header: string): { escrowId: Hex; mandateId: bigint } {
  const payload = decodePaymentSignatureHeader(header).payload as { authorization?: Hex };
  if (!payload.authorization) throw new Error("no authorization in the payment");
  const [terms] = decodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "mandateId", type: "uint256" },
          { name: "payee", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "undoSeconds", type: "uint32" },
          { name: "deliverBy", type: "uint64" },
          { name: "reviewSeconds", type: "uint32" },
        ],
      },
      { type: "bytes" },
    ],
    payload.authorization,
  );
  const escrowId = keccak256(
    encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [terms.mandateId, terms.nonce]),
  );
  return { escrowId, mandateId: terms.mandateId };
}
