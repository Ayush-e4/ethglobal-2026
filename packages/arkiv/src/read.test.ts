import { stringToBytes, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { decodeRow } from "./read";

const AGENT = "0x00000000000000000000000000000000000000a1";
const OTHER = "0x00000000000000000000000000000000000000b2";
const KEY = `0x${"11".repeat(32)}` as const;
const row = (creator: string, body: unknown) => ({
  $key: KEY,
  $creator: creator as `0x${string}`,
  $expiresAt: BigInt(500),
  body: { value: toHex(stringToBytes(JSON.stringify(body))) },
});
const quote = {
  agent: AGENT,
  task: "goa-trip",
  skill: "hotels",
  feeUnits: "20000",
  summary: "Sea Breeze, 2 nights",
};

describe("decodeRow trust rules", () => {
  it("accepts a quote written by the agent it names", () => {
    const d = decodeRow("quote", row(AGENT, quote));
    expect(d?.record.feeUnits).toBe("20000");
    expect(d?.expiresAt).toBe(BigInt(500));
  });

  it("drops a quote someone else wrote in the agent's name", () => {
    expect(decodeRow("quote", row(OTHER, quote))).toBeNull();
  });

  it("only trusts receipts from our own writer", () => {
    const receipt = {
      job: KEY,
      task: "goa-trip",
      mandateId: "1",
      payer: "0.0.10",
      payTo: "0.0.20",
      amountUnits: "20000",
      hederaTx: "0.0.30@1.2",
    };
    expect(decodeRow("receipt", row(OTHER, receipt), AGENT as `0x${string}`)).toBeNull();
    expect(decodeRow("receipt", row(AGENT, receipt), AGENT as `0x${string}`)?.record.payTo).toBe(
      "0.0.20",
    );
  });

  it("drops invalid bodies", () => {
    expect(decodeRow("quote", row(AGENT, { ...quote, feeUnits: "-1" }))).toBeNull();
    expect(decodeRow("quote", { ...row(AGENT, quote), body: { value: "0xzz" } })).toBeNull();
  });
});
