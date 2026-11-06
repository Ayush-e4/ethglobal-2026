import { agentRegistry } from "@app/erc8004";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { erc8004Market } from "./identity";

const AGENT = "0x6Cbc10D2313bc8a1D161FA34D64F673f170F452A";
const reporter = privateKeyToAccount(generatePrivateKey());
const card = (agentId: number) => Response.json({ registrations: [{ agentId, agentRegistry }] });

function setup(owner: string) {
  const registry = {
    ownerOf: vi.fn(async () => owner as `0x${string}`),
    giveFeedback: vi.fn(async () => "0xfeedback" as const),
    summary: vi.fn(async () => ({ count: 2, average: 4.5 })),
  };
  const m = erc8004Market({
    registry,
    reporter,
    fetchImpl: (async () => card(157)) as never,
    log: () => {},
  });
  return { m, registry };
}

describe("ERC-8004 on the market", () => {
  it("an identity counts only if the agent's own key owns it", async () => {
    expect(await setup(AGENT).m.identityOf(AGENT, "http://localhost:8803")).toBe(157n);
    const borrowed = setup("0x000000000000000000000000000000000000dEaD");
    expect(await borrowed.m.identityOf(AGENT, "http://localhost:8803")).toBeNull();
    expect(
      await borrowed.m.feedback({
        agent: AGENT,
        endpoint: "x",
        score: 5,
        arkivKey: "0x1",
        job: "0x2",
      }),
    ).toBeNull();
    expect(borrowed.registry.giveFeedback).not.toHaveBeenCalled();
  });

  it("a verified rating becomes feedback from our concierge, pointing at the rating on Arkiv", async () => {
    const { m, registry } = setup(AGENT);
    const tx = await m.feedback({
      agent: AGENT,
      endpoint: "http://localhost:8803",
      score: 4,
      arkivKey: "0xabc",
      job: "0x2",
    });
    expect(tx).toBe("0xfeedback");
    expect(registry.giveFeedback).toHaveBeenCalledWith(
      reporter,
      expect.objectContaining({
        agentId: 157n,
        value: 4n,
        decimals: 0,
        tag1: "starred",
        tag2: "world-id",
        feedbackURI: "https://rabdi.explorer.arkiv.network/entity/0xabc",
      }),
    );
    expect(await m.view(AGENT, "http://localhost:8803")).toMatchObject({
      agentId: "157",
      reputation: { count: 2, average: 4.5 },
    });
    expect(registry.summary).toHaveBeenCalledWith(157n, [reporter.address], "starred", "world-id");
  });
});
