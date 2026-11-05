import { describe, expect, it } from "vitest";
import { HederaIds } from "./ids";

const mirror = (routes: Record<string, unknown>) =>
  new HederaIds("https://m", async (url) => {
    const path = String(url).replace("https://m/api/v1", "");
    return path in routes ? Response.json(routes[path]) : new Response("{}", { status: 404 });
  });

describe("HederaIds", () => {
  it("prefers an account's alias address, and falls back to contracts", async () => {
    const ids = mirror({
      "/accounts/0.0.5": { evm_address: "0xAbC0000000000000000000000000000000000001" },
      "/contracts/0.0.7": { evm_address: "0x0000000000000000000000000000000000000007" },
    });
    expect(await ids.evmAddress("0.0.5")).toBe("0xabc0000000000000000000000000000000000001");
    expect(await ids.evmAddress("0.0.7")).toBe("0x0000000000000000000000000000000000000007");
    await expect(ids.evmAddress("0.0.8")).rejects.toThrow("no EVM address");
  });

  it("finds the id behind an address", async () => {
    const ids = mirror({
      "/contracts/0x0000000000000000000000000000000000000007": { contract_id: "0.0.7" },
    });
    expect(await ids.idOf("0x0000000000000000000000000000000000000007")).toBe("0.0.7");
  });

  it("sees custom fees", async () => {
    const ids = mirror({
      "/tokens/0.0.1": { custom_fees: { fixed_fees: [], fractional_fees: [] } },
      "/tokens/0.0.2": { custom_fees: { fractional_fees: [{}] } },
    });
    expect(await ids.hasCustomFees("0.0.1")).toBe(false);
    expect(await ids.hasCustomFees("0.0.2")).toBe(true);
  });
});
