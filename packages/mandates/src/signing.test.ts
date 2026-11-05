import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeAbiParameters, recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  type EscrowAuth,
  encodeEscrowAuthorization,
  encodePaymentAuthorization,
  mandateDomain,
  signEscrow,
} from "./signing";

const source = readFileSync(
  fileURLToPath(new URL("../../contracts/src/mandate/MandateSignatures.sol", import.meta.url)),
  "utf8",
);

const agent = privateKeyToAccount(generatePrivateKey());
const domain = mandateDomain(296, "0x00000000000000000000000000000000000000aa");
const auth: EscrowAuth = {
  mandateId: BigInt(3),
  payTo: "0x00000000000000000000000000000000000000bb",
  amount: BigInt(20_000),
  nonce: BigInt(42),
  validBefore: BigInt(1_800_000_000),
  undoSeconds: 60,
  deliverBy: BigInt(1_800_086_400),
  reviewSeconds: 3600,
};

describe("signing", () => {
  it("uses the exact type strings the contract hashes", () => {
    for (const t of [
      "PaymentAuth(uint256 mandateId,address payTo,uint256 amount,uint256 nonce,uint256 validBefore)",
      "EscrowAuth(uint256 mandateId,address payTo,uint256 amount,uint256 nonce,uint256 validBefore,uint32 undoSeconds,uint64 deliverBy,uint32 reviewSeconds)",
      "SubMandateAuth(uint256 parentId,address agent,uint128 budget,uint128 perPaymentCap,uint64 expiresAt,bytes32 payeesHash,uint256 nonce,uint256 validBefore)",
    ]) {
      expect(source).toContain(`"${t}"`);
    }
  });

  it("an escrow signature recovers to the agent", async () => {
    const signature = await signEscrow(agent, domain, auth);
    const signer = await recoverTypedDataAddress({
      domain,
      types: {
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
      },
      primaryType: "EscrowAuth",
      message: auth,
      signature,
    });
    expect(signer).toBe(agent.address);
  });

  it("encodes x402 authorizations the way the contract decodes them", () => {
    const sig = "0x1234";
    const [m, n, v, s] = decodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }],
      encodePaymentAuthorization(auth, sig),
    );
    expect([m, n, v, s]).toEqual([auth.mandateId, auth.nonce, auth.validBefore, sig]);

    const [terms, sig2] = decodeAbiParameters(
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
      encodeEscrowAuthorization(auth, sig),
    );
    expect(terms).toMatchObject({
      mandateId: auth.mandateId,
      undoSeconds: 60,
      reviewSeconds: 3600,
    });
    expect(sig2).toBe(sig);
  });
});
