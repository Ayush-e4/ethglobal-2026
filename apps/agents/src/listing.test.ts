import { beforeEach, describe, expect, it, vi } from "vitest";

const arkivCalls = vi.hoisted(() => ({
  agents: [] as { creator: string; expiresAt: bigint; record: Record<string, unknown> }[],
  listings: [] as { creator: string; expiresAt: bigint; record: Record<string, unknown> }[],
  published: [] as string[],
}));
vi.mock("@app/arkiv", () => ({
  findAgents: async () => arkivCalls.agents,
  findListings: async () => arkivCalls.listings,
  publishAgent: async () => void arkivCalls.published.push("profile+listing"),
  publishListings: async () => void arkivCalls.published.push("listing"),
}));
const { keepListed } = await import("./listing");

const AGENT = "0x00000000000000000000000000000000000000b1";
const profile = {
  agent: AGENT,
  name: "Bank Check",
  skill: "bank-check",
  description: "IFSC",
  endpoint: "https://heyshikigami.example/a/bankcheck",
  hederaAccount: "0.0.4242",
};
const listing = { agent: AGENT, skill: "bank-check", title: "Check an IFSC", feeUnits: "1000" };
const d = { arkiv: {} as never, reader: {} as never };

describe("keeping an agent on the market", () => {
  beforeEach(() => {
    arkivCalls.agents = [];
    arkivCalls.listings = [];
    arkivCalls.published = [];
  });

  it("not listed yet: publishes its profile and listing", async () => {
    expect(await keepListed(d, profile as never, listing as never)).toBe(false);
    expect(arkivCalls.published).toEqual(["profile+listing"]);
  });

  it("moved to a new address (a deploy): publishes its profile again", async () => {
    arkivCalls.agents = [
      { creator: AGENT, expiresAt: 1n, record: { ...profile, endpoint: "http://localhost:8804" } },
    ];
    expect(await keepListed(d, profile as never, listing as never)).toBe(true);
    expect(arkivCalls.published).toEqual(["profile+listing"]);
  });

  it("unchanged: writes nothing; only a changed listing is published again", async () => {
    arkivCalls.agents = [{ creator: AGENT, expiresAt: 1n, record: profile }];
    arkivCalls.listings = [{ creator: AGENT, expiresAt: 1n, record: listing }];
    await keepListed(d, profile as never, listing as never);
    expect(arkivCalls.published).toEqual([]);
    await keepListed(d, profile as never, { ...listing, feeUnits: "2000" } as never);
    expect(arkivCalls.published).toEqual(["listing"]);
  });
});
