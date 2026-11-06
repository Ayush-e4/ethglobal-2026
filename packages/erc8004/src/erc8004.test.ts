import { encodeAbiParameters, encodeEventTopics } from "viem";
import { describe, expect, it } from "vitest";
import { agentCard, ERC8004, identityRegistryAbi, registeredId } from "./index";

describe("ERC-8004", () => {
  it("an agent card per registration-v1, naming its id in the Hedera registry", () => {
    expect(
      agentCard({
        name: "SkyHop",
        description: "Flights",
        endpoint: "https://s.example",
        agentId: 157n,
      }),
    ).toEqual({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "SkyHop",
      description: "Flights",
      services: [{ name: "web", endpoint: "https://s.example" }],
      x402Support: true,
      active: true,
      registrations: [{ agentId: 157, agentRegistry: `eip155:296:${ERC8004.identity}` }],
      supportedTrust: ["reputation"],
    });
  });

  it("reads the agentId from the registry's Registered event, and only from the registry", () => {
    const owner = "0x6Cbc10D2313bc8a1D161FA34D64F673f170F452A";
    const topics = encodeEventTopics({
      abi: identityRegistryAbi,
      eventName: "Registered",
      args: { agentId: 157n, owner },
    });
    const data = encodeAbiParameters(
      [{ type: "string" }],
      ["https://s.example/.well-known/agent-card.json"],
    );
    const log = { address: ERC8004.identity, topics, data };
    expect(registeredId({ logs: [log] as never })).toBe(157n);
    expect(
      registeredId({
        logs: [{ ...log, address: "0x0000000000000000000000000000000000000001" }] as never,
      }),
    ).toBeNull();
  });
});
