import { describe, expect, it } from "vitest";
import { formatUsdc, parseUsdc } from "./usdc";

describe("usdc", () => {
  it("parses exact amounts", () => {
    expect(parseUsdc("4.2")).toBe(4_200_000n);
    expect(parseUsdc("0.000001")).toBe(1n);
    expect(parseUsdc("12")).toBe(12_000_000n);
  });

  it("rejects anything that isn't a plain amount", () => {
    for (const bad of ["", "-1", "1.0000001", "1e3", "abc", "1,5"]) {
      expect(() => parseUsdc(bad)).toThrow();
    }
  });

  it("formats with at least two decimals", () => {
    expect(formatUsdc(4_200_000n)).toBe("4.20");
    expect(formatUsdc(1n)).toBe("0.000001");
    expect(formatUsdc(-1_500_000n)).toBe("-1.50");
  });

  it("round-trips", () => {
    for (const s of ["0.10", "4.20", "999.123456"]) expect(formatUsdc(parseUsdc(s))).toBe(s);
  });
});
