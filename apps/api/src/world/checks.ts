import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { worldChecks as table, users, type WorldCheckStatus } from "../db/schema";
import type { Verified, WorldClient } from "./oidc";

export type CheckPurpose = "bonus";

/** One "prove you're a person" check, for one account and one purpose. */
export interface WorldCheck {
  id: string;
  userId: string;
  purpose: CheckPurpose;
  userCode: string;
  link: string; // where the person approves it (World's page, which opens World App)
  expiresAt: number; // ms
  status: WorldCheckStatus;
  reason?: string;
}

/** What a passed check unlocks; it may return a note for the person (e.g. "come back tomorrow"). */
export type OnVerified = (c: WorldCheck, v: Verified) => Promise<string | undefined>;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs World ID checks. The device code stays here (never in the browser or the model); we poll
 * World until the person approves, denies, or time runs out, then check the signed result and
 * that it's the World ID linked to this account (the first check links it). Only then does
 * `onVerified` run. Anything else unlocks nothing. Kept in the database: after a restart,
 * `resume()` picks up the waiting ones.
 */
export function worldChecks(
  db: Db,
  world: WorldClient,
  onVerified: OnVerified,
  wait: (ms: number) => Promise<void> = sleep,
  log: (line: string) => void = (line) => console.error(line),
) {
  const toCheck = (r: typeof table.$inferSelect): WorldCheck => ({
    id: r.id,
    userId: r.userId,
    purpose: r.purpose,
    userCode: r.userCode,
    link: r.link,
    expiresAt: r.expiresAt.getTime(),
    status: r.status,
    ...(r.reason ? { reason: r.reason } : {}),
  });

  /** One World ID per account, one account per World ID. */
  async function link(userId: string, iss: string, sub: string): Promise<string | null> {
    const [me] = await db.select().from(users).where(eq(users.id, userId));
    if (!me) return "account not found";
    if (me.worldSub)
      return me.worldIss === iss && me.worldSub === sub ? null : "a different World ID";
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.worldIss, iss), eq(users.worldSub, sub)));
    if (taken) return "this World ID is linked to another account";
    const linked = await db
      .update(users)
      .set({ worldIss: iss, worldSub: sub })
      .where(and(eq(users.id, userId), isNull(users.worldSub)))
      .returning({ id: users.id })
      .catch(() => []); // unique index: someone else linked it first
    return linked.length ? null : "couldn't link this World ID";
  }

  async function run(c: WorldCheck, deviceCode: string, startedAtS: number, interval: number) {
    let every = interval * 1000;
    const end = async (status: WorldCheckStatus, reason?: string) => {
      Object.assign(c, { status, reason });
      await db
        .update(table)
        .set({ status, reason: reason ?? null })
        .where(eq(table.id, c.id));
      log(`world: check ${c.id.slice(0, 8)} ${status}${reason ? ` (${reason})` : ""}`);
    };
    while (Date.now() < c.expiresAt) {
      await wait(every);
      const r = await world.poll(deviceCode);
      if (r.status === "pending") continue;
      if (r.status === "slow_down") {
        every += 5000;
        continue;
      }
      if (r.status !== "done") return end(r.status, r.error);
      let v: Verified;
      try {
        v = await world.verify(r.idToken, startedAtS);
      } catch (err) {
        return end("failed", err instanceof Error ? err.message : String(err));
      }
      const problem = await link(c.userId, v.iss, v.sub);
      if (problem) return end("mismatch", problem);
      const note = await onVerified(c, v).catch((err) => {
        log(`world: after check ${c.id.slice(0, 8)}: ${String(err).slice(0, 160)}`);
        return "verified, but what it unlocks didn't go through";
      });
      return end("verified", note);
    }
    return end("expired", "the check timed out");
  }

  const go = (c: WorldCheck, deviceCode: string, startedAtS: number, interval: number) =>
    void run(c, deviceCode, startedAtS, interval).catch(async (err) => {
      Object.assign(c, { status: "failed", reason: String(err) });
      await db
        .update(table)
        .set({ status: "failed", reason: String(err).slice(0, 200) })
        .where(eq(table.id, c.id))
        .catch(() => {});
    });

  return {
    async start(userId: string, purpose: CheckPurpose): Promise<WorldCheck> {
      const startedAtS = Math.floor(Date.now() / 1000);
      const d = await world.start();
      const c: WorldCheck = {
        id: randomUUID(),
        userId,
        purpose,
        userCode: d.userCode,
        link: d.verificationUriComplete ?? d.verificationUri,
        expiresAt: Date.now() + d.expiresIn * 1000,
        status: "waiting",
      };
      await db.insert(table).values({
        ...c,
        expiresAt: new Date(c.expiresAt),
        deviceCode: d.deviceCode,
        intervalS: d.interval,
        startedAtS,
      });
      go(c, d.deviceCode, startedAtS, d.interval);
      return c;
    },

    /** Someone else's check is simply "not found". */
    async get(id: string, userId: string): Promise<WorldCheck | null> {
      if (![id, userId].every((v) => UUID.test(v))) return null; // ids come from the URL
      const [r] = await db
        .select()
        .from(table)
        .where(and(eq(table.id, id), eq(table.userId, userId)));
      return r ? toCheck(r) : null;
    },

    /** The account's newest check for this purpose. */
    async latest(userId: string, purpose: CheckPurpose): Promise<WorldCheck | null> {
      const [r] = await db
        .select()
        .from(table)
        .where(and(eq(table.userId, userId), eq(table.purpose, purpose)))
        .orderBy(desc(table.createdAt))
        .limit(1);
      return r ? toCheck(r) : null;
    },

    /** After a restart: keep polling the checks that were still waiting; the rest timed out. */
    async resume() {
      const waiting = await db.select().from(table).where(eq(table.status, "waiting"));
      for (const r of waiting) {
        if (r.expiresAt.getTime() > Date.now())
          go(toCheck(r), r.deviceCode, r.startedAtS, r.intervalS);
        else
          await db
            .update(table)
            .set({ status: "expired", reason: "the check timed out" })
            .where(eq(table.id, r.id));
      }
      return waiting.length;
    },
  };
}

export type WorldChecks = ReturnType<typeof worldChecks>;
