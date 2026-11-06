import { describe, expect, it } from "vitest";
import { HireError } from "../hiring/errors";
import { LOOKUP_TERMS, NeedsLimit } from "../hiring/limits";
import type { Market, MarketAgent } from "./market";
import { runTool } from "./tools";

const form = {
  type: "object" as const,
  properties: { ifsc: { type: "string" as const, format: "ifsc" as const } },
  required: ["ifsc"],
};
const bank: MarketAgent = {
  name: "Bank Check",
  skill: "bank-check",
  description: "IFSC codes",
  agent: "0x00000000000000000000000000000000000000b1",
  endpoint: "http://bank",
  feeUnits: "1000",
  form,
  delivered: 0,
  kind: "lookup",
};
const market = {
  agents: async (skill: string) =>
    skill === "bank-check" ? [bank] : [{ ...bank, name: "StayWise", kind: "booking" }],
} as unknown as Market;
const answer = {
  title: "HDFC Bank, Sandoz House",
  lines: [{ label: "IFSC", value: "HDFC0000240" }],
  source: "Razorpay IFSC (public data)",
};
const ctx = { user: { id: "u1" } as never, chatId: "c1" };
const deps = (ask: NonNullable<Parameters<typeof runTool>[0]["ask"]>) => ({
  market,
  saveQuotes: async () => {},
  hire: async () => {
    throw new Error("not here");
  },
  ask,
});

describe("asking a lookup agent", () => {
  it("pays and answers: a card with what it found and its payment", async () => {
    const asked: unknown[] = [];
    const out = await runTool(
      deps(async (_u, _c, a, input) => {
        asked.push([a.name, input]);
        return { answer, payTx: "0.0.9@1.2", feeUnits: 1000n };
      }),
      ctx,
      "ask_agent",
      { skill: "bank-check", input: { ifsc: "HDFC0000240" } },
    );
    expect(asked).toEqual([["Bank Check", { ifsc: "HDFC0000240" }]]);
    expect(out.card).toMatchObject({ type: "answer", title: answer.title, payTx: "0.0.9@1.2" });
    expect(out.result).toContain("0.001 USDC");
  });

  it("checks the input against its form before paying anything", async () => {
    const out = await runTool(
      deps(async () => {
        throw new Error("must not pay");
      }),
      ctx,
      "ask_agent",
      { skill: "bank-check", input: { ifsc: "nope" } },
    );
    expect(out.result).toMatch(/Not asked: ifsc must be/);
  });

  it("only lookup agents: a booking skill goes through quotes", async () => {
    const out = await runTool(
      deps(async () => ({ answer, payTx: "", feeUnits: 0n })),
      ctx,
      "ask_agent",
      {
        skill: "hotels",
        input: {},
      },
    );
    expect(out.result).toMatch(/No lookup agent/);
  });

  it("a passkey account approves a small lookup limit first; a refusal says why", async () => {
    const limit = new NeedsLimit({
      type: "limit",
      agentName: "Bank Check",
      payee: bank.agent,
      budgetUnits: LOOKUP_TERMS.budget.toString(),
      capUnits: LOOKUP_TERMS.cap.toString(),
      hours: 24,
      reply: "Limit approved. Ask Bank Check again: HDFC0000240",
    });
    const needs = await runTool(
      deps(async () => Promise.reject(limit)),
      ctx,
      "ask_agent",
      {
        skill: "bank-check",
        input: { ifsc: "HDFC0000240" },
      },
    );
    expect(needs.card).toMatchObject({ type: "limit", budgetUnits: "20000" });
    const none = await runTool(
      deps(async () =>
        Promise.reject(new HireError("Bank Check: no such IFSC. Nothing was charged.")),
      ),
      ctx,
      "ask_agent",
      { skill: "bank-check", input: { ifsc: "HDFC0000240" } },
    );
    expect(none).toMatchObject({
      isError: true,
      result: expect.stringMatching(/Nothing was charged/),
    });
  });
});
