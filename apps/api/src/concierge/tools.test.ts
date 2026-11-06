import { describe, expect, it } from "vitest";
import { NeedsLimit } from "../hiring/limits";
import type { Market } from "./market";
import { stay } from "./quote-store";
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

const saved: unknown[] = [];
const deps = {
  market,
  saveQuotes: async (_chat: string, q: unknown[]) => {
    saved.push(...q);
  },
  hire: async () => ({
    id: "h1",
    title: "Sea Breeze",
    feeUnits: BigInt(20000),
    undoUntil: new Date(Date.now() + 60_000),
    payTx: "0.0.1@2.3",
  }),
};
const ctx = { user: { id: "u1" } as never, chatId: "c1" };

describe("concierge tools", () => {
  it("quotes become a card and a compact result for Claude", async () => {
    const out = await runTool(deps, ctx, "get_hotel_quotes", {
      iata: "GOI",
      checkin: "2026-12-06",
      checkout: "2026-12-08",
      adults: 2,
    });
    expect(out.card?.type).toBe("quotes");
    expect(out.result).toContain("Sea Breeze");
    expect(out.result).toContain("0.02 USDC");
    expect(saved).toHaveLength(1); // remembered for booking
  });

  it("booking returns a hire card with the undo deadline", async () => {
    const out = await runTool(deps, ctx, "book_quote", { quote: `0x${"cd".repeat(32)}` });
    expect(out.card).toMatchObject({ type: "hire", hireId: "h1", feeUnits: "20000" });
    expect((await runTool(deps, ctx, "book_quote", { quote: "first one" })).isError).toBe(true);
  });

  it("from the user's own wallet, with no limit yet: the Face ID limit card, not an error", async () => {
    const card = {
      type: "limit" as const,
      agentName: "StayWise",
      payee: `0x${"a7".repeat(20)}`,
      budgetUnits: "100000",
      capUnits: "50000",
      hours: 24,
      reply: "Limit approved. Book Sea Breeze (quote 0xcdcdcdcd)",
    };
    const needs = {
      ...deps,
      hire: async () => {
        throw new NeedsLimit(card);
      },
    };
    const out = await runTool(needs, ctx, "book_quote", { quote: `0x${"cd".repeat(32)}` });
    expect(out.isError).toBeFalsy();
    expect(out.card).toEqual(card);
    expect(out.result).toMatch(/^Not booked yet/);
  });

  it("refuses inputs that don't validate (they can arrive truncated)", async () => {
    expect(
      (await runTool(deps, ctx, "get_hotel_quotes", { iata: "Goa", checkin: "x" })).isError,
    ).toBe(true);
    expect(
      (
        await runTool(deps, ctx, "get_hotel_quotes", {
          iata: "GOI",
          checkin: "2026-12-08",
          checkout: "2026-12-06",
          adults: 2,
        })
      ).isError,
    ).toBe(true);
    expect((await runTool(deps, ctx, "nope", {})).isError).toBe(true);
  });

  it("lists agents as a card", async () => {
    const out = await runTool(deps, ctx, "find_agents", { skill: "hotels" });
    expect(out.card).toMatchObject({ type: "agents", skill: "hotels" });
  });
});

describe("stay", () => {
  it("reads like a person wrote it", () => {
    expect(stay("2026-12-14", "2026-12-16")).toBe("14–16 Dec");
    expect(stay("2026-12-30", "2027-01-02")).toBe("30 Dec – 2 Jan");
  });
});
