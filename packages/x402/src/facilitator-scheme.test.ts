import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { describe, expect, it } from "vitest";
import { MandateFacilitatorScheme } from "./facilitator-scheme";
import { HederaIds } from "./ids";

const fees = (custom: boolean) =>
  new HederaIds("https://mirror.test", async (url) => {
    if (String(url).includes("/tokens/")) {
      return Response.json({ custom_fees: { fixed_fees: custom ? [{ amount: 1 }] : [] } });
    }
    return new Response("{}", { status: 404 });
  });
const scheme = (custom = false) =>
  new MandateFacilitatorScheme({
    relayer: { id: "0.0.30", key: "ab".repeat(32) },
    executors: ["0.0.7000"],
    ids: fees(custom),
  });

const req: PaymentRequirements = {
  scheme: "exact",
  network: "hedera:testnet",
  asset: "0.0.429274",
  amount: "20000",
  payTo: "0.0.20",
  maxTimeoutSeconds: 120,
  extra: { assetTransferMethod: "transferExecutor", executors: ["0.0.7000"] },
};
const pay = (payload: Record<string, unknown>): PaymentPayload => ({
  x402Version: 2,
  accepted: req,
  payload: { payer: "0.0.10", executor: "0.0.7000", authorization: "0x1234", ...payload },
});

describe("MandateFacilitatorScheme refuses before touching the network", () => {
  it("advertises transferExecutor with its admitted executors and the relayer", () => {
    expect(scheme().getExtra()).toEqual({
      assetTransferMethods: ["transferExecutor"],
      executors: ["0.0.7000"],
    });
    expect(scheme().getSigners()).toEqual(["0.0.30"]);
  });

  it("checks network, method and payload shape", async () => {
    const s = scheme();
    expect((await s.verify(pay({}), { ...req, network: "hedera:mainnet" })).invalidReason).toBe(
      "invalid_network",
    );
    expect((await s.verify(pay({}), { ...req, extra: {} })).invalidReason).toBe(
      "invalid_exact_hedera_unsupported_asset_transfer_method",
    );
    expect((await s.verify(pay({ payer: "alice" }), req)).invalidReason).toBe(
      "invalid_exact_hedera_payload_payer",
    );
    expect((await s.verify(pay({ authorization: "zz" }), req)).invalidReason).toBe(
      "invalid_exact_hedera_payload_authorization",
    );
  });

  it("only calls admitted contracts (default deny)", async () => {
    expect((await scheme().verify(pay({ executor: "0.0.6666" }), req)).invalidReason).toBe(
      "invalid_exact_hedera_executor_not_admitted",
    );
  });

  it("refuses HBAR and tokens with custom fees", async () => {
    expect((await scheme().verify(pay({}), { ...req, asset: "0.0.0" })).invalidReason).toBe(
      "invalid_payment_requirements",
    );
    expect((await scheme(true).verify(pay({}), req)).invalidReason).toBe(
      "invalid_exact_hedera_custom_fee_asset",
    );
  });

  it("can't resolve unknown accounts", async () => {
    expect((await scheme().verify(pay({}), req)).invalidReason).toBe("address_resolution_failed");
  });

  it("settle refuses the same way, and nothing is submitted", async () => {
    const r = await scheme().settle(pay({ executor: "0.0.6666" }), req);
    expect(r).toMatchObject({
      success: false,
      errorReason: "invalid_exact_hedera_executor_not_admitted",
      transaction: "",
    });
  });
});
