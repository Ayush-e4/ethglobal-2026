import { encodeEscrowAuthorization } from "@app/mandates";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { encodeAbiParameters, keccak256 } from "viem";
import { describe, expect, it } from "vitest";
import { escrowIdFromHeader } from "./escrow-id";

describe("escrowIdFromHeader", () => {
  it("finds the registry's escrow id in a paid request's header", () => {
    const auth = {
      mandateId: BigInt(9),
      payTo: "0x00000000000000000000000000000000000000aa" as const,
      amount: BigInt(20000),
      nonce: BigInt(77),
      validBefore: BigInt(1),
      undoSeconds: 60,
      deliverBy: BigInt(2),
      reviewSeconds: 120,
    };
    const header = encodePaymentSignatureHeader({
      x402Version: 2,
      accepted: {} as never,
      payload: {
        payer: "0.0.1",
        executor: "0.0.2",
        authorization: encodeEscrowAuthorization(auth, "0x12"),
      },
    });
    const expected = keccak256(
      encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [BigInt(9), BigInt(77)]),
    );
    expect(escrowIdFromHeader(header)).toEqual({ escrowId: expected, mandateId: BigInt(9) });
  });
});
