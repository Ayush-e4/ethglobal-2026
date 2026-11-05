import { describe, expect, it } from "vitest";
import { policyGas } from "./safe-writer";

describe("policyGas (Arkiv's Rabdi write rule)", () => {
  it("is at least 1M for one operation, +400k for each more", () => {
    expect(policyGas(BigInt(100_000), 1)).toBe(BigInt(1_000_000));
    expect(policyGas(BigInt(100_000), 3)).toBe(BigInt(1_800_000));
  });

  it("is twice the estimate when that's higher", () => {
    expect(policyGas(BigInt(900_000), 1)).toBe(BigInt(1_800_000));
  });
});
