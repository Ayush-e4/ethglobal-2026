import { encodePaymentRequiredHeader } from "@x402/core/http";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSession } from "../auth/session";
import type { Market, MarketAgent } from "../concierge/market";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import { testDb } from "../test/db";
import { checkAgent, sampleInput } from "./checks";
import { agentReviewService } from "./reviews";
import { listMessage, marketRoutes } from "./routes";

const REGISTRY = "0.0.11329685";
const key = privateKeyToAccount(generatePrivateKey());
const AGENT = key.address;
const QUOTE = `0x${"ab".repeat(32)}`;
const FORM = {
  type: "object" as const,
  properties: {
    from: { type: "string" as const, format: "iata" as const, examples: ["BOM"] },
    to: { type: "string" as const, format: "iata" as const, examples: ["GOI"] },
    date: { type: "string" as const, format: "date" as const, examples: ["2020-01-01"] },
    back: { type: "string" as const, format: "date" as const },
    adults: { type: "integer" as const, minimum: 1 },
  },
  required: ["from", "to", "date", "back", "adults"],
};
const agent: MarketAgent = {
  name: "Testy",
  skill: "flights",
  description: "Test agent",
  agent: AGENT,
  endpoint: "https://agent.example",
  feeUnits: "30000",
  form: FORM,
  delivered: 4,
  disputes: 0,
};

/** A fake agent server: up, quoting one offer, asking for payment with these escrow terms. */
function fakeAgent(
  terms: Partial<{
    payTo: string;
    payee: string;
    amount: string;
    undo: number;
    review: number;
  }> = {},
  up = true,
) {
  const t = { payTo: REGISTRY, payee: AGENT, amount: "30000", undo: 60, review: 900, ...terms };
  return vi.fn(async (url: URL | string) => {
    const path = new URL(String(url)).pathname;
    if (path === "/health")
      return up ? Response.json({ ok: true }) : new Response("", { status: 503 });
    if (path === "/quote")
      return Response.json({
        offers: [
          { key: QUOTE, title: "Air India", summary: "Air India · BOM → GOI", feeUnits: "30000" },
        ],
      });
    const header = encodePaymentRequiredHeader({
      x402Version: 2,
      resource: { url: "https://agent.example/book", description: "", mimeType: "" },
      accepts: [
        {
          scheme: "exact",
          network: "hedera:testnet",
          amount: t.amount,
          asset: "0.0.429274",
          payTo: t.payTo,
          maxTimeoutSeconds: 300,
          extra: {
            escrow: {
              payee: t.payee,
              undoSeconds: t.undo,
              deliverWithinSeconds: 1800,
              reviewSeconds: t.review,
            },
          },
        },
      ],
    } as never);
    return new Response("{}", { status: 402, headers: { "payment-required": header } });
  });
}
const signed = async () => new Set([`${QUOTE}|${AGENT}`.toLowerCase()]);
afterEach(() => vi.unstubAllGlobals());

describe("checking an agent like a buyer would", () => {
  it("asks a sample job from its own form: examples, dates ahead, the second after the first", () => {
    const s = sampleInput(FORM, new Date("2026-11-06T00:00:00Z"));
    expect(s).toEqual({
      from: "BOM",
      to: "GOI",
      date: "2026-12-06",
      back: "2026-12-08",
      adults: 1,
    });
  });

  it("passes a good agent", async () => {
    const checks = await checkAgent(agent, {
      registryId: REGISTRY,
      signedQuotes: signed,
      fetchImpl: fakeAgent() as never,
    });
    expect(checks.map((c) => [c.id, c.ok])).toEqual([
      ["secure", true],
      ["reachable", true],
      ["quotes", true],
      ["signed", true],
      ["terms", true],
      ["record", true],
    ]);
  });

  it.each([
    ["the fee goes elsewhere", { payTo: "0.0.666" }, /doesn't go into our escrow/],
    [
      "the escrow pays someone else",
      { payee: "0x000000000000000000000000000000000000dEaD" },
      /pays someone else/,
    ],
    ["no real undo window", { undo: 5 }, /undo window is under 30 s/],
    ["no review window", { review: 60 }, /review window is under 10 minutes/],
    ["a bigger fee than listed", { amount: "900000" }, /other than its fee plus the quoted price/],
  ])("fails when %s", async (_, terms, why) => {
    const checks = await checkAgent(agent, {
      registryId: REGISTRY,
      signedQuotes: signed,
      fetchImpl: fakeAgent(terms) as never,
    });
    const t = checks.find((c) => c.id === "terms");
    expect(t?.ok).toBe(false);
    expect(t?.note).toMatch(why);
  });

  it("fails offers it didn't sign on Arkiv, plain http, and too many reported problems", async () => {
    const checks = await checkAgent(
      { ...agent, endpoint: "http://agent.example", disputes: 4, delivered: 5 },
      {
        registryId: REGISTRY,
        signedQuotes: async () => new Set(),
        fetchImpl: fakeAgent() as never,
      },
    );
    const failed = checks.filter((c) => !c.ok).map((c) => c.id);
    expect(failed).toEqual(["secure", "signed", "record"]);
  }, 10_000);
});

async function setup() {
  const db: Db = await testDb();
  const market = { all: async () => [agent], agents: async () => [agent] } as unknown as Market;
  const lines: string[] = [];
  const reviews = agentReviewService(db, {
    market,
    reader: {} as never,
    writer: null,
    registryId: REGISTRY,
    house: new Set(),
    allowLocalHttp: false,
    signedQuotes: signed,
    log: (l) => lines.push(l),
  });
  return { db, reviews, market, lines };
}

describe("the market's gate", () => {
  it("shows an agent once it passes; one failed check is a blip, two in a row hide it", async () => {
    const { reviews } = await setup();
    vi.stubGlobal("fetch", fakeAgent());
    expect((await reviews.review(agent, { operator: "verified-person" })).status).toBe("approved");
    expect((await reviews.shown()).has(AGENT.toLowerCase())).toBe(true);
    vi.stubGlobal("fetch", fakeAgent({}, false));
    expect((await reviews.review(agent, { operator: "verified-person" })).status).toBe("approved");
    const r = await reviews.review(agent, { operator: "verified-person" });
    expect(r).toMatchObject({ status: "suspended", failures: 2 });
    expect((await reviews.shown()).has(AGENT.toLowerCase())).toBe(false);
  });

  it("no look-alikes: an approved agent's name stays its own", async () => {
    const { db, reviews } = await setup();
    vi.stubGlobal("fetch", fakeAgent());
    await reviews.review(agent, { operator: "verified-person" });
    const copy = {
      ...agent,
      agent: privateKeyToAccount(generatePrivateKey()).address,
      name: "testy ",
    };
    const market = { all: async () => [agent, copy] } as unknown as Market;
    const r2 = agentReviewService(db, {
      market,
      reader: {} as never,
      writer: null,
      registryId: REGISTRY,
      house: new Set(),
      allowLocalHttp: false,
      signedQuotes: async () => new Set([`${QUOTE}|${copy.agent}`.toLowerCase()]),
      log: () => {},
    });
    const fake = fakeAgent({ payee: copy.agent });
    vi.stubGlobal("fetch", fake);
    const r = await r2.review(copy, { operator: "verified-person" });
    expect(r.status).toBe("failed");
    expect(r.checks[0]).toMatchObject({ id: "name", ok: false });
  });

  it("listing: World ID first, then the agent's own signature for this account", async () => {
    const { db, reviews, market } = await setup();
    vi.stubGlobal("fetch", fakeAgent());
    const app = marketRoutes(db, { market, reviews });
    const [user] = await db.insert(users).values({}).returning();
    if (!user) throw new Error("no user");
    const cookie = `app_session=${await createSession(db, user.id)}`;
    const list = (signature: string) =>
      app.request("/market/list", {
        method: "POST",
        headers: { Cookie: cookie, "content-type": "application/json" },
        body: JSON.stringify({ agent: AGENT, signature }),
      });
    const good = await key.signMessage({ message: listMessage(AGENT, user.id) });
    expect((await list(good)).status).toBe(403); // not verified with World ID yet
    await db.update(users).set({ worldSub: "world-sub-test" });
    const someoneElse = await privateKeyToAccount(generatePrivateKey()).signMessage({
      message: listMessage(AGENT, user.id),
    });
    expect((await list(someoneElse)).status).toBe(403);
    const ok = await list(good);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      name: "Testy",
      review: { status: "approved", operator: "verified-person" },
    });
    const page = await (await app.request(`/market/agents/${AGENT}`)).json();
    expect(page).toMatchObject({ endpointHost: "agent.example", review: { status: "approved" } });
  });
});
