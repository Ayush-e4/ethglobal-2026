import { mandateDomain } from "@app/mandates";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { MandateClientScheme, UnexpectedTerms } from "./client-scheme";
import { ATM } from "./payload";

const REGISTRY = "0x3287ee420479437d57fcace38368c3df98e32737";
const AGENT = "0x00000000000000000000000000000000000000a1";
const OTHER = "0x00000000000000000000000000000000000000e7";
const ids = {
  idOf: async () => "0.0.11329685",
  evmAddress: async (id: string) => (id === "0.0.11329685" ? REGISTRY : AGENT),
};
const registry = {
  registry: REGISTRY,
  domain: () => mandateDomain(296, REGISTRY),
  escrowIdOf: async () => `0x${"aa".repeat(32)}`,
};
const scheme = (expect?: object) =>
  new MandateClientScheme({
    agent: privateKeyToAccount(generatePrivateKey()),
    mandateId: 7n,
    owner: "0.0.1",
    registry: registry as never,
    ids: ids as never,
    minUndoSeconds: 30,
    expect: expect as never,
  });
const held = (amount: string, escrow: object = {}) => ({
  scheme: "exact",
  network: "hedera:testnet",
  asset: "0.0.429274",
  amount,
  payTo: "0.0.11329685",
  maxTimeoutSeconds: 120,
  extra: {
    assetTransferMethod: ATM,
    executors: ["0.0.11329685"],
    escrow: {
      payee: AGENT,
      undoSeconds: 60,
      deliverWithinSeconds: 1800,
      reviewSeconds: 900,
      ...escrow,
    },
  },
});
const agreed = { maxAmount: 31_633n, payee: AGENT, escrowOnly: true, minReviewSeconds: 600 };

describe("the AI's key signs only what was agreed", () => {
  it("within the quote's terms: signed", async () => {
    const r = await scheme(agreed).createPaymentPayload(2, held("31633") as never);
    expect(r.payload).toMatchObject({ payer: "0.0.1" });
  });

  it.each([
    ["more than the quote", held("200000"), /more than/],
    ["an escrow paying someone else", held("31633", { payee: OTHER }), /someone other/],
    ["no review window", held("31633", { reviewSeconds: 0 }), /review window/],
    ["paid directly instead of into escrow", { ...held("31633"), payTo: "0.0.99" }, /directly/],
  ])("a 402 asking for %s is refused before signing", async (_, req, why) => {
    await expect(scheme(agreed).createPaymentPayload(2, req as never)).rejects.toThrow(
      UnexpectedTerms,
    );
    await expect(scheme(agreed).createPaymentPayload(2, req as never)).rejects.toThrow(why);
  });
});
