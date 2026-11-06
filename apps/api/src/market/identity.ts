import { ARKIV_EXPLORER } from "@app/arkiv";
import { agentRegistry, type Erc8004Client, hashscanToken } from "@app/erc8004";
import { keccak256, type LocalAccount, toHex } from "viem";
import { z } from "zod";

const Card = z.object({
  registrations: z
    .array(z.object({ agentId: z.union([z.number(), z.string()]), agentRegistry: z.string() }))
    .default([]),
});
const TTL_MS = 10 * 60_000;

/**
 * Agents' ERC-8004 identities and reputation on Hedera. An agent's card (from its own server)
 * names its agentId; it only counts if the IdentityRegistry says the agent's own key owns that
 * id, so a card can't borrow someone else's identity (or send our feedback there).
 */
export function erc8004Market(d: {
  registry: Pick<Erc8004Client, "ownerOf" | "giveFeedback" | "summary">;
  reporter: LocalAccount | null; // gives feedback: the concierge, the client that hires agents
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}) {
  const get = d.fetchImpl ?? fetch;
  const log = d.log ?? ((l: string) => console.error(l));
  const cache = new Map<string, { at: number; id: bigint | null }>();

  async function identityOf(agent: string, endpoint: string): Promise<bigint | null> {
    const key = agent.toLowerCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.id;
    const base = endpoint.endsWith("/") ? endpoint : `${endpoint}/`;
    const card = Card.safeParse(
      await get(new URL(".well-known/agent-card.json", base), { signal: AbortSignal.timeout(8000) })
        .then((r) => r.json())
        .catch(() => null),
    );
    const named = card.success
      ? card.data.registrations.find(
          (r) => r.agentRegistry.toLowerCase() === agentRegistry.toLowerCase(),
        )
      : undefined;
    let id: bigint | null = null;
    if (named) {
      const claimed = BigInt(named.agentId);
      const owner = await d.registry.ownerOf(claimed).catch(() => null);
      id = owner?.toLowerCase() === key ? claimed : null;
    }
    cache.set(key, { at: Date.now(), id });
    return id;
  }

  return {
    identityOf,

    /** For an agent's page: its identity, and its ratings from verified people, on Hedera. */
    async view(agent: string, endpoint: string) {
      const id = await identityOf(agent, endpoint);
      if (id === null) return null;
      const rep = d.reporter
        ? await d.registry
            .summary(id, [d.reporter.address], "starred", "world-id")
            .catch(() => null)
        : null;
      return {
        agentId: id.toString(),
        url: hashscanToken(id),
        reputation: rep,
        reporter: d.reporter?.address ?? null,
      };
    },

    /** A verified person's rating (posted on Arkiv), also as ERC-8004 feedback from our client. */
    async feedback(r: {
      agent: string;
      endpoint: string;
      score: number;
      arkivKey: string;
      job: string;
    }) {
      if (!d.reporter) return null;
      const id = await identityOf(r.agent, r.endpoint);
      if (id === null) return null;
      const record = JSON.stringify({
        agent: r.agent,
        job: r.job,
        score: r.score,
        verified: "world-id",
      });
      return d.registry
        .giveFeedback(d.reporter, {
          agentId: id,
          value: BigInt(r.score),
          decimals: 0,
          tag1: "starred",
          tag2: "world-id",
          endpoint: r.endpoint,
          feedbackURI: ARKIV_EXPLORER.entity(r.arkivKey),
          feedbackHash: keccak256(toHex(record)),
        })
        .catch((err) => {
          log(`erc8004: feedback for ${r.agent.slice(0, 10)} failed: ${String(err).slice(0, 160)}`);
          return null;
        });
    },
  };
}

export type Erc8004Market = ReturnType<typeof erc8004Market>;
