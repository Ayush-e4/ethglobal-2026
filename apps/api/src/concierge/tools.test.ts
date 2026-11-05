import { describe, expect, it } from "vitest";
import type { Market } from "./market";
import { runTool } from "./tools";

const agent = {
  name: "StayWise",
  skill: "hotels",
  description: "Hotels",
  agent: "0x00000000000000000000000000000000000000a1" as const,
  endpoint: "http://x",
  feeUnits: "20000",
};
const market = {
  agents: async () => [agent],
  hotelQuotes: async () => ({
    task: "t1",
    quotes: [
      {
        key: `0x${"cd".repeat(32)}` as `0x${string}`,
        agent,
        hotelName: "Sea Breeze",
        roomName: "Deluxe",
        total: 8400.4,
        currency: "INR",
        refundable: true,
        feeUnits: "20000",
        checkin: "2026-12-06",
        checkout: "2026-12-08",
      },
    ],
  }),
} as unknown as Market;

describe("concierge tools", () => {
  it("quotes become a card and a compact result for Claude", async () => {
    const out = await runTool(market, "get_hotel_quotes", {
      iata: "GOI",
      checkin: "2026-12-06",
      checkout: "2026-12-08",
      adults: 2,
    });
    expect(out.card?.type).toBe("quotes");
    expect(out.result).toContain("Sea Breeze");
    expect(out.result).toContain("0.02 USDC");
  });

  it("refuses inputs that don't validate (they can arrive truncated)", async () => {
    expect((await runTool(market, "get_hotel_quotes", { iata: "Goa", checkin: "x" })).isError).toBe(
      true,
    );
    expect(
      (
        await runTool(market, "get_hotel_quotes", {
          iata: "GOI",
          checkin: "2026-12-08",
          checkout: "2026-12-06",
          adults: 2,
        })
      ).isError,
    ).toBe(true);
    expect((await runTool(market, "nope", {})).isError).toBe(true);
  });

  it("lists agents as a card", async () => {
    const out = await runTool(market, "find_agents", { skill: "hotels" });
    expect(out.card).toMatchObject({ type: "agents", skill: "hotels" });
  });
});
