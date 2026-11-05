import { type ArkivReader, findAgents, findListings, liveQuotes } from "@app/arkiv";
import { z } from "zod";

export interface MarketAgent {
  name: string;
  skill: string;
  description: string;
  agent: `0x${string}`;
  endpoint: string;
  feeUnits: string; // its cheapest listing
}

export interface HotelQuote {
  key: `0x${string}`; // the quote's Arkiv entity
  agent: MarketAgent;
  hotelName: string;
  roomName: string;
  total: number;
  currency: string;
  refundable?: boolean;
  feeUnits: string;
  checkin: string;
  checkout: string;
}

const QuoteReply = z.object({
  key: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  hotelName: z.string().max(200),
  roomName: z.string().max(200),
  total: z.number().positive(),
  currency: z.string().max(5),
  refundable: z.boolean().optional(),
  feeUnits: z.string().regex(/^\d+$/),
  checkin: z.string(),
  checkout: z.string(),
});

/** Third-party endpoints: http(s) only, a time limit and a size cap. */
async function getJson(url: URL, fetchImpl: typeof fetch): Promise<unknown> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("bad endpoint");
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(45_000) });
  const text = await res.text();
  if (!res.ok || text.length > 64_000) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(text);
}

/**
 * The market as the concierge sees it: agents listed on Arkiv, and live quotes from their own
 * APIs. A quote only counts if the agent also signed it on Arkiv (same key, written by that
 * agent), so an agent's API can't claim a price it didn't commit to.
 */
export function arkivMarket(reader: ArkivReader, fetchImpl: typeof fetch = fetch) {
  return {
    async agents(skill?: string): Promise<MarketAgent[]> {
      const [profiles, listings] = await Promise.all([
        findAgents(reader, skill),
        skill ? findListings(reader, skill) : Promise.resolve([]),
      ]);
      return profiles.map(({ record: a }) => {
        const fees = listings
          .filter((l) => l.record.agent.toLowerCase() === a.agent.toLowerCase())
          .map((l) => BigInt(l.record.feeUnits));
        const cheapest = fees.length ? fees.reduce((m, f) => (f < m ? f : m)) : BigInt(0);
        return {
          name: a.name,
          skill: a.skill,
          description: a.description,
          agent: a.agent as `0x${string}`,
          endpoint: a.endpoint,
          feeUnits: cheapest.toString(),
        };
      });
    },

    async hotelQuotes(q: { iata: string; checkin: string; checkout: string; adults: number }) {
      const task = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const agents = await this.agents("hotels");
      const replies = await Promise.all(
        agents.map(async (agent) => {
          const url = new URL(
            "quote",
            agent.endpoint.endsWith("/") ? agent.endpoint : `${agent.endpoint}/`,
          );
          for (const [k, v] of Object.entries({ task, ...q })) url.searchParams.set(k, String(v));
          const parsed = QuoteReply.safeParse(await getJson(url, fetchImpl).catch(() => null));
          return parsed.success ? { ...parsed.data, agent } : null;
        }),
      );
      const offered = replies.filter((r) => r !== null);
      if (offered.length === 0) return { task, quotes: [] as HotelQuote[] };
      // Arkiv can lag a block behind the agent's reply: check, and once more after a moment.
      let signed = new Set<string>();
      for (let i = 0; i < 2 && signed.size < offered.length; i++) {
        if (i) await new Promise((r) => setTimeout(r, 2500));
        signed = new Set(
          (await liveQuotes(reader, task)).map((x) => `${x.key}|${x.creator}`.toLowerCase()),
        );
      }
      const quotes = offered
        .filter((o) => signed.has(`${o.key}|${o.agent.agent}`.toLowerCase()))
        .map((o) => ({ ...o, key: o.key as `0x${string}` }))
        .sort((a, b) => a.total - b.total);
      return { task, quotes };
    },
  };
}

export type Market = ReturnType<typeof arkivMarket>;
