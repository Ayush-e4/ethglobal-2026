import { type ArkivReader, liveQuotes, recordReview, type SafeArkivWriter } from "@app/arkiv";
import { eq } from "drizzle-orm";
import type { Market, MarketAgent } from "../concierge/market";
import type { Db } from "../db/client";
import { type AgentReview, agentReviews, quotes, type ReviewStatus } from "../db/schema";
import { type Check, checkAgent } from "./checks";

const EVERY_MS = 60 * 60_000; // approved agents are checked again hourly
const ARKIV_REFRESH_MS = 24 * 60 * 60_000; // an unchanged review is re-posted daily

/**
 * The marketplace's gate. An agent is shown only once its review passes; approved agents are
 * checked again every hour. One failed check is let pass once (a blip); a second in a row hides
 * it, and too many reported problems hide it at once. Ours are reviewed like anyone's.
 */
export function agentReviewService(
  db: Db,
  d: {
    market: Market;
    reader: ArkivReader;
    writer: SafeArkivWriter | null; // our Arkiv writer: posts each review
    registryId: string;
    house: Set<string>; // our own agents (lowercase addresses): answered for by Shikigami
    allowLocalHttp: boolean;
    log?: (line: string) => void;
    signedQuotes?: (task: string) => Promise<Set<string>>; // tests: instead of Arkiv
  },
) {
  const log = d.log ?? ((l: string) => console.log(l));
  let cache: { at: number; set: Set<string> } | null = null;

  const houseNames = async () =>
    (await d.market.all())
      .filter((a) => d.house.has(a.agent.toLowerCase()))
      .map((a) => [a.agent.toLowerCase(), a.name.trim().toLowerCase()] as const);
  const approvedNames = async () => {
    const ok = await (async () => {
      const rows = await db.select().from(agentReviews);
      return new Set(rows.filter((r) => r.status === "approved").map((r) => r.agent));
    })();
    return (await d.market.all())
      .filter((a) => ok.has(a.agent.toLowerCase()))
      .map((a) => [a.agent.toLowerCase(), a.name.trim().toLowerCase()] as const);
  };

  const get = async (agent: string) =>
    (await db.select().from(agentReviews).where(eq(agentReviews.agent, agent.toLowerCase())))[0] ??
    null;

  async function review(
    a: MarketAgent,
    who: { operator: "agentnet" | "verified-person"; ownerUserId?: string | null },
  ): Promise<AgentReview> {
    const id = a.agent.toLowerCase();
    const prev = await get(id);
    const checks: Check[] = await checkAgent(
      {
        agent: a.agent,
        endpoint: a.endpoint,
        feeUnits: a.feeUnits,
        form: a.form,
        delivered: a.delivered,
        disputes: a.disputes ?? 0,
        kind: a.kind,
        hederaAccount: a.hederaAccount,
      },
      {
        registryId: d.registryId,
        // Our own agents run beside the API on the server, at local addresses.
        allowLocalHttp: d.allowLocalHttp || d.house.has(id),
        signedQuotes:
          d.signedQuotes ??
          (async (task) =>
            new Set(
              (await liveQuotes(d.reader, task)).map((x) => `${x.key}|${x.creator}`.toLowerCase()),
            )),
      },
    ).catch((err): Check[] => [{ id: "reachable", ok: false, note: String(err).slice(0, 120) }]);
    // No look-alikes: a name already taken by one of ours or an approved agent stays theirs.
    const taken = new Set(
      [...(await approvedNames()), ...(await houseNames())]
        .filter(([addr]) => addr !== id)
        .map(([, n]) => n),
    );
    if (taken.has(a.name.trim().toLowerCase()))
      checks.unshift({
        id: "name",
        ok: false,
        note: `"${a.name}" is already another agent's name`,
      });
    if (d.house.has(id)) forgiveHouseRecord(checks);
    const failed = checks.filter((c) => !c.ok);
    const failures = failed.length ? (prev?.failures ?? 0) + 1 : 0;
    const status: ReviewStatus =
      failed.length === 0
        ? "approved"
        : failed.some((c) => c.id === "record")
          ? "suspended"
          : prev?.status === "approved" && failures < 2
            ? "approved" // one blip: checked again next round
            : prev?.status === "approved"
              ? "suspended"
              : "failed";
    const note = failed.length ? failed.map((c) => c.note).join("; ") : null;
    const row = {
      agent: id,
      status,
      operator: who.operator,
      ownerUserId: who.ownerUserId ?? prev?.ownerUserId ?? null,
      checks,
      failures,
      note,
      checkedAt: new Date(),
    };
    await db
      .insert(agentReviews)
      .values(row)
      .onConflictDoUpdate({ target: agentReviews.agent, set: row });
    cache = null;
    if (status !== prev?.status)
      log(`review: ${a.name} ${prev?.status ?? "new"} → ${status}${note ? ` (${note})` : ""}`);

    // On Arkiv: when it changed, and daily otherwise (a review lives 30 days there).
    const stale = !prev?.arkivAt || Date.now() - prev.arkivAt.getTime() > ARKIV_REFRESH_MS;
    if (d.writer && (status !== prev?.status || stale)) {
      const posted = await recordReview(d.writer, {
        agent: a.agent,
        status,
        operator: who.operator,
        checks,
        reviewedAt: Math.floor(Date.now() / 1000),
      }).catch((err) => {
        log(`review: Arkiv record for ${a.name} failed: ${String(err).slice(0, 120)}`);
        return null;
      });
      if (posted)
        await db
          .update(agentReviews)
          .set({ arkivKey: posted.entityKey, arkivAt: new Date() })
          .where(eq(agentReviews.agent, id));
    }
    return (await get(id)) as AgentReview;
  }

  /** Checks our own agents that need it, and every approved agent due again. */
  async function round() {
    const all = await d.market.all();
    for (const a of all) {
      const r = await get(a.agent);
      const house = d.house.has(a.agent.toLowerCase());
      const due = !r || Date.now() - r.checkedAt.getTime() > EVERY_MS;
      if (!due || (!house && r?.status !== "approved")) continue;
      await review(
        a,
        house ? { operator: "agentnet" } : { operator: r?.operator ?? "verified-person" },
      );
    }
  }

  return {
    get,
    review,
    round,
    /** The agents the market may show (cached briefly). */
    async shown(): Promise<Set<string>> {
      if (cache && Date.now() - cache.at < 20_000) return cache.set;
      const rows = await db
        .select({ agent: agentReviews.agent, status: agentReviews.status })
        .from(agentReviews);
      const set = new Set(rows.filter((r) => r.status === "approved").map((r) => r.agent));
      cache = { at: Date.now(), set };
      return set;
    },
    all: () => db.select().from(agentReviews),
    /** A buyer reported a problem with a job (by its quote): look at the agent's record now. */
    async onDispute(quoteKey: string) {
      const [q] = await db
        .select({ agent: quotes.agentAddress })
        .from(quotes)
        .where(eq(quotes.key, quoteKey));
      if (!q) return;
      const agent = q.agent;
      const a = (await d.market.all()).find((x) => x.agent.toLowerCase() === agent.toLowerCase());
      const r = await get(agent);
      if (a && r) await review(a, { operator: r.operator, ownerUserId: r.ownerUserId });
    },
    start() {
      const run = () =>
        void round().catch((err) => log(`review: round failed: ${String(err).slice(0, 160)}`));
      setTimeout(run, 5_000);
      setInterval(run, 10 * 60_000).unref();
    },
  };
}

export type AgentReviewService = ReturnType<typeof agentReviewService>;

/**
 * Ours are never suspended on reports alone (a report costs nothing to file): we look into them
 * ourselves. The record check still shows them.
 */
export function forgiveHouseRecord(checks: Check[]) {
  for (const c of checks)
    if (c.id === "record" && !c.ok) {
      c.ok = true;
      c.note = `${c.note} (one of ours: we look into reports ourselves)`.slice(0, 200);
    }
  return checks;
}
