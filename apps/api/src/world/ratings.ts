import { createHmac } from "node:crypto";
import type { Rating } from "@app/arkiv";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { type Hire, hires, quotes, ratings } from "../db/schema";
import type { WorldCheck } from "./checks";

/** A hire can be rated once its agent did the job. */
export const rateable = (h: Pick<Hire, "status">) =>
  h.status === "delivered" || h.status === "released";

/**
 * A person's pseudonym for one agent: their World ID always gives the same one for that agent (so
 * only one rating counts), and a different one for every other agent (so their ratings can't be
 * linked). Keyed with our secret, so nobody can work it out from a World ID.
 */
export const raterId = (secret: string, iss: string, sub: string, agent: string) =>
  `0x${createHmac("sha256", secret).update(`${iss}|${sub}|${agent.toLowerCase()}`).digest("hex")}`;

export interface RatingsOptions {
  secret: string;
  post: ((r: Rating) => Promise<{ entityKey: string; txHash: string }>) | null; // to Arkiv
  // Then, also as ERC-8004 feedback on Hedera: its transaction, or null.
  alsoTo?: (r: {
    agent: string;
    endpoint: string;
    score: number;
    arkivKey: string;
    job: string;
  }) => Promise<string | null>;
  log?: (line: string) => void;
}

/**
 * Verified people's ratings of agents. Posted to Arkiv by our writer (readers trust only ours),
 * and only after World ID: the account's linked World ID, or a check passed for this rating.
 * Rating an agent again replaces the earlier rating.
 */
export function worldRatings(db: Db, o: RatingsOptions) {
  const log = o.log ?? ((line: string) => console.error(line));

  /** The user's hire, with the address of the agent that did it. */
  async function hireOf(userId: string, hireId: string) {
    const [row] = await db
      .select({ hire: hires, agent: quotes.agentAddress, endpoint: quotes.endpoint })
      .from(hires)
      .innerJoin(quotes, eq(quotes.key, hires.quoteKey))
      .where(and(eq(hires.id, hireId), eq(hires.userId, userId)));
    return row ? { ...row.hire, agent: row.agent.toLowerCase(), endpoint: row.endpoint } : null;
  }

  async function rate(
    userId: string,
    hireId: string,
    score: number,
    who: { iss: string; sub: string },
  ): Promise<string | undefined> {
    const hire = await hireOf(userId, hireId).catch(() => null);
    if (!hire || !rateable(hire) || !hire.escrowId) return "that job can't be rated";
    if (!Number.isInteger(score) || score < 1 || score > 5) return "a rating is 1 to 5";
    const rater = raterId(o.secret, who.iss, who.sub, hire.agent);
    const row = { userId, hireId, score, status: "posting" as const, updatedAt: new Date() };
    await db
      .insert(ratings)
      .values({ rater, agent: hire.agent, ...row })
      .onConflictDoUpdate({
        target: [ratings.rater, ratings.agent],
        set: { ...row, arkivKey: null, arkivTx: null },
      });
    const mine = and(eq(ratings.rater, rater), eq(ratings.agent, hire.agent));
    try {
      if (!o.post) throw new Error("no Arkiv writer on this server");
      const posted = await o.post({
        agent: hire.agent,
        job: hire.escrowId,
        rater,
        score,
        verified: "world-id",
      });
      await db
        .update(ratings)
        .set({ status: "posted", arkivKey: posted.entityKey, arkivTx: posted.txHash })
        .where(mine);
      void o
        .alsoTo?.({
          agent: hire.agent,
          endpoint: hire.endpoint,
          score,
          arkivKey: posted.entityKey,
          job: hire.escrowId,
        })
        .then((tx) => tx && db.update(ratings).set({ erc8004Tx: tx }).where(mine))
        .catch(() => {});
      return undefined;
    } catch (err) {
      log(`ratings: posting for hire ${hireId.slice(0, 8)} failed: ${String(err).slice(0, 160)}`);
      await db.update(ratings).set({ status: "failed" }).where(mine);
      return "your rating didn't reach Arkiv this time";
    }
  }

  return {
    hireOf,
    rate,

    /** From a passed "rate" check: its ref says which hire, and the score. */
    fromCheck(c: WorldCheck, who: { iss: string; sub: string }) {
      const [hireId = "", score = ""] = (c.ref ?? "").split(":");
      return rate(c.userId, hireId, Number(score), who);
    },

    /** This account's rating of the agent that did this hire (from this hire or another). */
    async mine(userId: string, agent: string) {
      const [r] = await db
        .select()
        .from(ratings)
        .where(and(eq(ratings.userId, userId), eq(ratings.agent, agent.toLowerCase())))
        .orderBy(desc(ratings.updatedAt))
        .limit(1);
      return r ?? null;
    },
  };
}

export type WorldRatings = ReturnType<typeof worldRatings>;
