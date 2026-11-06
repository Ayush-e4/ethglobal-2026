import { describe, expect, it } from "vitest";
import { NeedsLimit } from "../hiring/limits";
import { NeedsHuman } from "../world/checkpoint";
import type { Market } from "./market";
import { runTool } from "./tools";

const form = {
  type: "object" as const,
  properties: { iata: { type: "string" as const, format: "iata" as const } },
  required: ["iata"],
};
const agent = {
  name: "StayWise",
  skill: "hotels",
  description: "Hotels",
  agent: "0x00000000000000000000000000000000000000a1" as const,
  endpoint: "http://x",
  feeUnits: "20000",
  form,
  delivered: 0,
};
const offer = {
  key: `0x${"cd".repeat(32)}` as `0x${string}`,
  agent,
  title: "Sea Breeze",
  subtitle: "Deluxe",
  summary: "Sea Breeze · 6–8 Dec",
  price: { amount: 8400.4, currency: "INR" },
  refundable: true,
  feeUnits: "20000",
};
const asked: unknown[] = [];
const market = {
  agents: async () => [agent],
  search: async (need?: string) => ({
    agents: need?.includes("hotel") ? [agent] : [],
    matched: true,
    total: 1,
  }),
  forms: async () => [
    { agent, form },
    { agent: { ...agent, name: "RoomRadar" }, form },
  ],
  quotes: async (_skill: string, input: unknown) => {
    asked.push(input);
    return (input as { iata?: string }).iata === "GOI"
      ? { task: "t1", offers: [offer], problems: [] }
      : { task: "t1", offers: [], problems: ["StayWise: iata must be an airport code like GOI"] };
  },
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
  it("agent_input shows each distinct form once, with who uses it", async () => {
    const out = await runTool(deps, ctx, "agent_input", { skill: "hotels" });
    expect(JSON.parse(out.result)).toEqual([{ agents: ["StayWise", "RoomRadar"], form }]);
  });

  it("offers become a card and a compact result for Claude, and are remembered", async () => {
    const out = await runTool(deps, ctx, "get_quotes", { skill: "hotels", input: { iata: "GOI" } });
    expect(out.card).toMatchObject({ type: "quotes", skill: "hotels" });
    expect(out.result).toContain("Sea Breeze");
    expect(out.result).toContain("0.02 USDC");
    expect(out.result).toContain("INR 8400");
    expect(saved).toHaveLength(1); // only offers shown here can be hired from this chat
  });

  it("a form filled wrong comes back as what to fix, not an error", async () => {
    const out = await runTool(deps, ctx, "get_quotes", { skill: "hotels", input: { iata: "Goa" } });
    expect(out.isError).toBeFalsy();
    expect(out.result).toMatch(/iata must be an airport code/);
  });

  it("hiring returns a hire card with the undo deadline", async () => {
    const out = await runTool(deps, ctx, "hire", { quote: `0x${"cd".repeat(32)}` });
    expect(out.card).toMatchObject({ type: "hire", hireId: "h1", feeUnits: "20000" });
    expect((await runTool(deps, ctx, "hire", { quote: "first one" })).isError).toBe(true);
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
    const out = await runTool(needs, ctx, "hire", { quote: `0x${"cd".repeat(32)}` });
    expect(out.isError).toBeFalsy();
    expect(out.card).toEqual(card);
    expect(out.result).toMatch(/^Not booked yet/);
  });

  it("a larger hire with no World ID approval yet: the World ID card, and nothing paid", async () => {
    const card = {
      type: "human" as const,
      agentName: "PriceGuard",
      feeUnits: "50000",
      quoteKey: `0x${"cd".repeat(32)}`,
      reply: "Approved with World ID. Book Sea Breeze (quote 0xcdcdcdcd)",
    };
    const needs = {
      ...deps,
      hire: async () => {
        throw new NeedsHuman(card);
      },
    };
    const out = await runTool(needs, ctx, "hire", { quote: card.quoteKey });
    expect(out.isError).toBeFalsy();
    expect(out.card).toEqual(card);
    expect(out.result).toMatch(/^Not booked yet.*World ID.*nothing is paid/);
  });

  it("refuses inputs that don't validate (they can arrive truncated)", async () => {
    expect((await runTool(deps, ctx, "get_quotes", { skill: "Hotels!" })).isError).toBe(true);
    expect(
      (await runTool(deps, ctx, "get_quotes", { skill: "hotels", input: "GOI" })).isError,
    ).toBe(true);
    expect((await runTool(deps, ctx, "agent_input", {})).isError).toBe(true);
    expect((await runTool(deps, ctx, "nope", {})).isError).toBe(true);
  });

  it("finds agents by what the user needs, with how each works", async () => {
    const out = await runTool(deps, ctx, "find_agents", { need: "a hotel in Goa" });
    expect(out.card).toMatchObject({ type: "agents", skill: "hotels" });
    expect(JSON.parse(out.result)[0]).toMatchObject({ name: "StayWise", delivered: 0 });
    expect((await runTool(deps, ctx, "find_agents", { need: "a haircut" })).result).toMatch(
      /No agents/,
    );
  });

  it("lists agents as a card", async () => {
    const out = await runTool(deps, ctx, "find_agents", { skill: "hotels" });
    expect(out.card).toMatchObject({ type: "agents", skill: "hotels" });
  });
});
