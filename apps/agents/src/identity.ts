import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { agentCard, Erc8004Client, hashscanToken } from "@app/erc8004";
import type { Hono } from "hono";
import type { LocalAccount } from "viem";

/**
 * The agent's ERC-8004 identity on Hedera: an NFT in the official IdentityRegistry that its own
 * key owns, pointing at its agent card (served at /.well-known/agent-card.json). Registered once
 * (the id is kept in the data dir); if its address changes (a deploy), the pointer is updated.
 * Optional: without it the agent still works.
 */
export function agentIdentity(d: {
  id: string;
  name: string;
  description: string;
  publicUrl: string;
  dataDir: string;
  agent: LocalAccount;
  erc8004?: Pick<Erc8004Client, "register" | "setAgentURI" | "registeredId" | "tokenURI">;
  log?: (line: string) => void;
}) {
  const file = `${d.dataDir}/${d.id}-erc8004.json`;
  const uri = `${d.publicUrl}/.well-known/agent-card.json`;
  const log = d.log ?? ((l: string) => console.log(l));
  let saved: { agentId: string; uri: string } | null = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : null;

  return {
    card: () =>
      agentCard({
        name: d.name,
        description: d.description,
        endpoint: d.publicUrl,
        agentId: saved?.agentId,
      }),
    routes(app: Hono) {
      app.get("/.well-known/agent-card.json", (c) => c.json(this.card()));
    },
    async ensure() {
      const reg = d.erc8004 ?? new Erc8004Client();
      try {
        // Registered before but not written down (a send that timed out, a fresh deploy's
        // empty data dir): use that identity, never a second one.
        const found = saved ? null : await reg.registeredId(d.agent.address);
        if (found !== null) {
          saved = { agentId: found.toString(), uri: String(await reg.tokenURI(found)) };
          writeFileSync(file, JSON.stringify(saved));
          log(`${d.name}: found its ERC-8004 agent #${found} on Hedera`);
        }
        if (!saved) {
          const r = await reg.register(d.agent, uri);
          saved = { agentId: r.agentId.toString(), uri };
          writeFileSync(file, JSON.stringify(saved));
          log(`${d.name}: ERC-8004 agent #${r.agentId} on Hedera: ${hashscanToken(r.agentId)}`);
        } else if (saved.uri !== uri) {
          await reg.setAgentURI(d.agent, BigInt(saved.agentId), uri);
          saved = { ...saved, uri };
          writeFileSync(file, JSON.stringify(saved));
          log(`${d.name}: ERC-8004 agent #${saved.agentId} now points at ${uri}`);
        }
      } catch (err) {
        log(`${d.name}: ERC-8004 identity not updated: ${String(err).slice(0, 160)}`);
      }
      return saved;
    },
  };
}
