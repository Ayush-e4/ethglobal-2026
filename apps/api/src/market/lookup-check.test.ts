import { encodePaymentRequiredHeader } from "@x402/core/http";
import { describe, expect, it, vi } from "vitest";
import { checkAgent } from "./checks";

const FORM = {
  type: "object" as const,
  properties: {
    ifsc: { type: "string" as const, format: "ifsc" as const, examples: ["HDFC0000240"] },
  },
  required: ["ifsc"],
};
const lookup = {
  agent: "0x00000000000000000000000000000000000000b1" as const,
  endpoint: "https://bank.example",
  feeUnits: "1000",
  form: FORM,
  delivered: 0,
  kind: "lookup" as const,
  hederaAccount: "0.0.4242",
};

/** A lookup agent: asks for its fee over x402 for its own example, or finds nothing. */
const fakeLookup = (t: { payTo?: string; amount?: string; found?: boolean } = {}) =>
  vi.fn(async (url: URL | string) => {
    const u = new URL(String(url));
    if (u.pathname === "/health") return Response.json({ ok: true });
    if (u.pathname !== "/answer" || u.searchParams.get("ifsc") !== "HDFC0000240")
      return new Response("", { status: 400 });
    if (t.found === false) return Response.json({ message: "nothing" }, { status: 404 });
    const header = encodePaymentRequiredHeader({
      x402Version: 2,
      resource: { url: u.toString(), description: "", mimeType: "" },
      accepts: [
        {
          scheme: "exact",
          network: "hedera:testnet",
          amount: t.amount ?? "1000",
          asset: "0.0.429274",
          payTo: t.payTo ?? "0.0.4242",
          maxTimeoutSeconds: 300,
          extra: {},
        },
      ],
    } as never);
    return new Response("{}", { status: 402, headers: { "payment-required": header } });
  });

const check = (fetchImpl: unknown, a = lookup) =>
  checkAgent(a, {
    registryId: "0.0.1",
    signedQuotes: async () => new Set(),
    fetchImpl: fetchImpl as never,
  });

describe("checking a lookup agent", () => {
  it("passes one that asks its listed fee for a sample lookup, paid to itself", async () => {
    const checks = await check(fakeLookup());
    expect(checks.map((c) => [c.id, c.ok])).toEqual([
      ["secure", true],
      ["reachable", true],
      ["answers", true],
      ["record", true],
    ]);
  });

  it.each([
    ["the fee goes to someone else", { payTo: "0.0.666" }, /someone else/],
    ["it asks more than listed", { amount: "5000" }, /other than its listed fee/],
    ["it finds nothing for its own example", { found: false }, /found nothing/],
  ])("fails when %s", async (_, t, why) => {
    const a = (await check(fakeLookup(t))).find((c) => c.id === "answers");
    expect(a?.ok).toBe(false);
    expect(a?.note).toMatch(why);
  });

  it("a lookup is tiny: over 0.01 USDC is a job, not a lookup", async () => {
    const a = (await check(fakeLookup({ amount: "50000" }), { ...lookup, feeUnits: "50000" })).find(
      (c) => c.id === "answers",
    );
    expect(a?.note).toMatch(/over 0.01 USDC/);
  });
});
