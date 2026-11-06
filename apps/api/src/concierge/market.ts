import { type ArkivReader, findAgents, findListings, liveQuotes } from "@app/arkiv";
import { checkForm, type Form, type Offer, QuoteReplySchema } from "@app/shared";

export interface MarketAgent {
  name: string;
  skill: string;
  description: string;
  agent: `0x${string}`;
  endpoint: string;
  feeUnits: string; // its listed fee
  form?: Form; // what it needs filled to quote
}

/** A firm offer, with the agent that made it (and signed it on Arkiv). */
export type MarketOffer = Offer & { key: `0x${string}`; agent: MarketAgent };

/** Third-party endpoints: http(s) only, a time limit and a size cap. */
async function getJson(url: URL, fetchImpl: typeof fetch): Promise<unknown> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("bad endpoint");
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(45_000) });
  const text = await res.text();
  if (!res.ok || text.length > 128_000) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(text);
}

/** The newest record per agent: an update is a new record, and the old one expires later. */
function newestByAgent<T extends { expiresAt: bigint; record: { agent: string } }>(rows: T[]) {
  const best = new Map<string, T>();
  for (const r of rows) {
    const id = r.record.agent.toLowerCase();
    const seen = best.get(id);
    if (!seen || r.expiresAt > seen.expiresAt) best.set(id, r);
  }
  return best;
}

/**
 * Cheapest first, then the lower fee. (Where reliability comes in later: how often each agent
 * delivered, from its Arkiv record.)
 */
export const rankOffers = (offers: MarketOffer[]) =>
  [...offers].sort(
    (a, b) =>
      (a.price?.amount ?? Number.POSITIVE_INFINITY) -
        (b.price?.amount ?? Number.POSITIVE_INFINITY) ||
      Number(BigInt(a.feeUnits) - BigInt(b.feeUnits)),
  );

/**
 * The market as the concierge sees it: agents listed on Arkiv with the form each needs, and
 * live offers from their own APIs. An offer only counts if the agent also signed it on Arkiv
 * (same key, written by that agent), so an agent's API can't claim a price it didn't commit to.
 */
export function arkivMarket(reader: ArkivReader, fetchImpl: typeof fetch = fetch) {
  async function agents(skill?: string): Promise<MarketAgent[]> {
    const profiles = newestByAgent(await findAgents(reader, skill));
    const skills = [...new Set([...profiles.values()].map((p) => p.record.skill))];
    const listings = newestByAgent(
      (await Promise.all(skills.map((s) => findListings(reader, s)))).flat(),
    );
    return [...profiles.values()].map(({ record: a }) => {
      const l = listings.get(a.agent.toLowerCase())?.record;
      return {
        name: a.name,
        skill: a.skill,
        description: a.description,
        agent: a.agent as `0x${string}`,
        endpoint: a.endpoint,
        feeUnits: l?.feeUnits ?? "0",
        form: l?.input,
      };
    });
  }

  return {
    agents,

    /** What the agents with this skill need filled to quote it. */
    async forms(skill: string) {
      return (await agents(skill)).flatMap((a) => (a.form ? [{ agent: a, form: a.form }] : []));
    },

    /**
     * Asks every agent with this skill for firm offers. The input is checked against each
     * agent's own form first; `problems` says what was wrong, per agent.
     */
    async quotes(skill: string, input: unknown) {
      const task = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const quoting = (await agents(skill)).filter((a) => a.form);
      const problems: string[] = [];
      if (quoting.length === 0) problems.push(`No agent on the market quotes "${skill}" yet.`);
      const replies = await Promise.all(
        quoting.map(async (agent) => {
          const filled = checkForm(agent.form as Form, input);
          if (!filled.ok) {
            problems.push(`${agent.name}: ${filled.problems.join("; ")}`);
            return [];
          }
          const base = agent.endpoint.endsWith("/") ? agent.endpoint : `${agent.endpoint}/`;
          const url = new URL("quote", base);
          url.searchParams.set("task", task);
          for (const [k, v] of Object.entries(filled.values)) url.searchParams.set(k, String(v));
          const reply = QuoteReplySchema.safeParse(await getJson(url, fetchImpl).catch(() => null));
          if (!reply.success) problems.push(`${agent.name} had nothing for that.`);
          return reply.success ? reply.data.offers.map((o) => ({ ...o, agent })) : [];
        }),
      );
      const offered = replies.flat();
      if (offered.length === 0) return { task, offers: [] as MarketOffer[], problems };
      // Arkiv can lag a block behind the agent's reply: check, and once more after a moment.
      let signed = new Set<string>();
      for (let i = 0; i < 2 && signed.size < offered.length; i++) {
        if (i) await new Promise((r) => setTimeout(r, 2500));
        signed = new Set(
          (await liveQuotes(reader, task)).map((x) => `${x.key}|${x.creator}`.toLowerCase()),
        );
      }
      const offers = offered
        .filter((o) => signed.has(`${o.key}|${o.agent.agent}`.toLowerCase()))
        .map((o) => ({ ...o, key: o.key as `0x${string}` }));
      return { task, offers: rankOffers(offers), problems };
    },
  };
}

export type Market = ReturnType<typeof arkivMarket>;
