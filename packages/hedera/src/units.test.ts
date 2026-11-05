import { describe, expect, it } from "vitest";
import { formatHbar } from "./units";

describe("formatHbar", () => {
  it("formats tinybars exactly", () => {
    expect(formatHbar(BigInt(1_234_500_000))).toBe("12.345 HBAR");
    expect(formatHbar(BigInt(100_000_000))).toBe("1 HBAR");
    expect(formatHbar(BigInt(1))).toBe("0.00000001 HBAR");
  });
});
