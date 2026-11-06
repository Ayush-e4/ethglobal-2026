import {
  type ArkivReader,
  disputesByAgent,
  findAgents,
  findListings,
  liveQuotes,
  recentDeliveries,
  verifiedRatings,
} from "@app/arkiv";
import { checkForm, type Form, type Offer, QuoteReplySchema, type Service } from "@app/shared";

export interface MarketAgent {
  name: string;
  skill: string;
  description: string;
  agent: `0x${string}`;
  endpoint: string;
  feeUnits: string; // its listed fee
  form?: Form; // what it needs filled to quote
  service?: Service; // how it does the job, in its own words
  title?: string; // its listing's title
  delivered: number; // jobs it completed recently, by its own Arkiv records
  rating?: { average: number; count: number }; // from verified people (World ID), on Arkiv
  disputes?: number; // its jobs a buyer reported a problem with, on Arkiv (written by us)
  hederaAccount?: string; // where it's paid
  profileKey?: `0x${string}`; // its Arkiv entities
  listingKey?: `0x${string}`;
}

/** At most this many agents are asked for one job: the best rated and most reliable first. */
export const MAX_ASKED = 10;

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
 * A rating's weight in ranking: the average, pulled towards neutral (3 stars) as if two more
 * people had given 3, so one 5-star rating can't top the market. Unrated agents count as 3.
 */
export const ratingScore = (r?: { average: number; count: number }) =>
  r ? (r.average * r.count + 3 * 2) / (r.count + 2) : 3;

/** Its record: jobs delivered, with each reported problem counting against it as three. */
export const track = (a: MarketAgent) => a.delivered - 3 * (a.disputes ?? 0);

/** Best rated by verified people first, then the best record, then the lower fee. */
export const rankAgents = (agents: MarketAgent[]) =>
  [...agents].sort(
    (a, b) =>
      ratingScore(b.rating) - ratingScore(a.rating) ||
      track(b) - track(a) ||
      Number(BigInt(a.feeUnits) - BigInt(b.feeUnits)),
  );

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
/** Words that say nothing about the job: "a flight from Mumbai" mustn't match "choose from". */
const FILLER = new Set(
  "the and for from with that this into onto near about around via book booking booked find need want get please can could will would just some any one two also then your our my me agent agents job jobs".split(
    " ",
  ),
);
/**
 * How well an agent matches a need in plain words: its skill counts most, then its listing and
 * how it works, then its description. Plain word overlap: enough for a market of hundreds.
 */
export function matchScore(a: MarketAgent, need: string) {
  const want = new Set(words(need).filter((w) => w.length > 2 && !FILLER.has(w)));
  const hits = (text: string | undefined, weight: number) =>
    words(text ?? "").filter(
      (w) => want.has(w) || want.has(`${w}s`) || want.has(w.replace(/s$/, "")),
    ).length * weight;
  return (
    hits(a.skill, 5) +
    hits(a.title, 2) +
    hits(a.service?.model, 2) +
    hits(a.service?.promise, 1) +
    hits(a.description, 1) +
    hits(a.name, 1)
  );
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
export function arkivMarket(
  reader: ArkivReader,
  fetchImpl: typeof fetch = fetch,
  platform?: `0x${string}`, // our Arkiv writer: the only one whose ratings count
  shown?: () => Promise<Set<string>>, // the agents our review let in (lowercase addresses)
) {
  /** The agents on Arkiv: only those our review let in, unless `all` (for the review itself). */
  async function agents(skill?: string, all = false): Promise<MarketAgent[]> {
    const [found, done, rated, disputed] = await Promise.all([
      findAgents(reader, skill),
      // Reliability and ratings are ranking hints: without them, the market still works.
      recentDeliveries(reader).catch((err) => {
        console.error(`market: deliveries unavailable: ${String(err).slice(0, 120)}`);
        return [];
      }),
      platform
        ? verifiedRatings(reader, platform).catch((err) => {
            console.error(`market: ratings unavailable: ${String(err).slice(0, 120)}`);
            return new Map<string, { average: number; count: number }>();
          })
        : new Map<string, { average: number; count: number }>(),
      platform
        ? disputesByAgent(reader, platform).catch(() => new Map<string, number>())
        : new Map<string, number>(),
    ]);
    const profiles = newestByAgent(found);
    const skills = [...new Set([...profiles.values()].map((p) => p.record.skill))];
    const listings = newestByAgent(
      (await Promise.all(skills.map((s) => findListings(reader, s)))).flat(),
    );
    const delivered = new Map<string, number>();
    for (const d of done) {
      const id = d.record.agent.toLowerCase();
      delivered.set(id, (delivered.get(id) ?? 0) + 1);
    }
    const allowed = all || !shown ? null : await shown();
    const listed = [...profiles.values()].filter(
      (p) => !allowed || allowed.has(p.record.agent.toLowerCase()),
    );
    return listed.map(({ record: a, key }) => {
      const found = listings.get(a.agent.toLowerCase());
      const l = found?.record;
      return {
        name: a.name,
        skill: a.skill,
        description: a.description,
        agent: a.agent as `0x${string}`,
        endpoint: a.endpoint,
        feeUnits: l?.feeUnits ?? "0",
        form: l?.input,
        service: l?.service,
        title: l?.title,
        delivered: delivered.get(a.agent.toLowerCase()) ?? 0,
        rating: rated.get(a.agent.toLowerCase()),
        disputes: disputed.get(a.agent.toLowerCase()) ?? 0,
        hederaAccount: a.hederaAccount,
        profileKey: key,
        listingKey: found?.key,
      };
    });
  }

  return {
    agents,
    /** Every agent on Arkiv, reviewed or not: for the review and the agent pages. */
    all: () => agents(undefined, true),

    /**
     * Agents that can quote, best match for a need in plain words first (all of them, most
     * reliable first, when there's no need or nothing matches).
     */
    async search(need?: string, limit = 8) {
      const quoting = (await agents()).filter((a) => a.form);
      const scored = need
        ? quoting.map((a) => ({ a, score: matchScore(a, need) })).filter((x) => x.score > 0)
        : [];
      // Only the agents that match about as well as the best one: no hotels for a flight.
      const top = Math.max(0, ...scored.map((x) => x.score));
      const close = scored.filter((x) => x.score * 2 >= top);
      const found = close.length
        ? close.sort((x, y) => y.score - x.score).map((x) => x.a)
        : rankAgents(quoting);
      return { agents: found.slice(0, limit), matched: scored.length > 0, total: quoting.length };
    },

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
      const quoting = rankAgents((await agents(skill)).filter((a) => a.form)).slice(0, MAX_ASKED);
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
