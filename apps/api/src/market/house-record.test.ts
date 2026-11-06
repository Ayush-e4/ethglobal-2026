import { describe, expect, it } from "vitest";
import { forgiveHouseRecord } from "./reviews";

describe("our own agents and reports", () => {
  it("a bad record never suspends one of ours by itself; it still shows", () => {
    const checks = forgiveHouseRecord([
      { id: "reachable", ok: true, note: "Up" },
      { id: "record", ok: false, note: "4 jobs delivered, 3 reported: too many problems" },
    ]);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks[1]?.note).toMatch(/3 reported.*one of ours/);
  });
});
