import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { agentIdentity } from "./identity";

describe("an agent's ERC-8004 identity", () => {
  it("registers once with its own key, then only moves its pointer when its address changes", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "id-"));
    const erc8004 = {
      register: vi.fn(async () => ({ agentId: 42n, tx: "0x1" as const })),
      setAgentURI: vi.fn(async () => "0x2" as const),
    };
    const agent = privateKeyToAccount(generatePrivateKey());
    const base = {
      id: "skyhop",
      name: "SkyHop",
      description: "Flights",
      dataDir,
      agent,
      erc8004,
      log: () => {},
    };
    const a = agentIdentity({ ...base, publicUrl: "http://localhost:8803" });
    expect(a.card().registrations).toEqual([]);
    await a.ensure();
    await a.ensure();
    expect(erc8004.register).toHaveBeenCalledTimes(1);
    expect(erc8004.register).toHaveBeenCalledWith(
      agent,
      "http://localhost:8803/.well-known/agent-card.json",
    );
    expect(a.card()).toMatchObject({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "SkyHop",
      x402Support: true,
      registrations: [
        { agentId: 42, agentRegistry: "eip155:296:0x8004A818BFB912233c491871b3d84c89A494BD9e" },
      ],
    });
    // Deployed elsewhere: same identity, new pointer.
    const moved = agentIdentity({ ...base, publicUrl: "https://skyhop.example" });
    await moved.ensure();
    expect(erc8004.register).toHaveBeenCalledTimes(1);
    expect(erc8004.setAgentURI).toHaveBeenCalledWith(
      agent,
      42n,
      "https://skyhop.example/.well-known/agent-card.json",
    );
  });
});
