import type { Rating } from "@app/arkiv";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createSession } from "../auth/session";
import type { Db } from "../db/client";
import { chats, hires, quotes, ratings as ratingRows, users } from "../db/schema";
import { testDb } from "../test/db";
import { fakeWorld, ISS, token } from "../test/world";
import { worldChecks } from "./checks";
import type { Poll } from "./oidc";
import { onWorldVerified } from "./on-verified";
import { ratingRoutes } from "./rating-routes";
import { raterId, worldRatings } from "./ratings";

const PRICEGUARD = `0x${"ab".repeat(20)}`;
const ESCROW = `0x${"e5".repeat(32)}`;
type View = {
  canRate?: boolean;
  verified?: boolean;
  rating?: { score: number; status: string; entity: string | null } | null;
  check?: { id: string; status: string };
  note?: string;
};

async function setup(o: { postFails?: boolean } = {}) {
  const db: Db = await testDb();
  const posted: Rating[] = [];
  const post = async (r: Rating) => {
    if (o.postFails) throw new Error("rabdi is down");
    posted.push(r);
    return { entityKey: `0x${"0e".repeat(32)}`, txHash: `0x${"0f".repeat(32)}` };
  };
  const ratings = worldRatings(db, { secret: "test-secret", post, log: () => {} });
  let answer: Poll = { status: "pending" };
  const tick = () => new Promise<void>((r) => setTimeout(r, 2));
  const onVerified = onWorldVerified({ bonus: null as never, ratings });
  const checks = worldChecks(db, await fakeWorld(async () => answer), onVerified, tick, () => {});
  const app = ratingRoutes(db, ratings, checks);

  let n = 0;
  /** An account with a chat and a PriceGuard hire (delivered, unless said otherwise). */
  const account = async (a: { isDemo?: boolean; sub?: string; status?: "held" } = {}) => {
    const [user] = await db
      .insert(users)
      .values({ isDemo: a.isDemo ?? false, ...(a.sub ? { worldIss: ISS, worldSub: a.sub } : {}) })
      .returning();
    if (!user) throw new Error("no user");
    const [chat] = await db.insert(chats).values({ userId: user.id, title: "Goa" }).returning();
    if (!chat) throw new Error("no chat");
    const key = `0x${(++n).toString(16).padStart(64, "0")}`;
    await db.insert(quotes).values({
      key,
      chatId: chat.id,
      agentName: "PriceGuard",
      agentAddress: PRICEGUARD,
      endpoint: "http://localhost:8802",
      feeUnits: 50_000n,
      summary: "Park Inn · Goa",
      expiresAt: new Date(),
    });
    const [hire] = await db
      .insert(hires)
      .values({
        chatId: chat.id,
        userId: user.id,
        quoteKey: key,
        agentName: "PriceGuard",
        title: "Park Inn · Goa",
        feeUnits: 50_000n,
        status: a.status ?? "delivered",
        escrowId: ESCROW,
      })
      .returning();
    if (!hire) throw new Error("no hire");
    const cookie = `app_session=${await createSession(db, user.id)}`;
    const path = `/chats/${chat.id}/hires/${hire.id}/rating`;
    return { user, path, cookie };
  };
  const call = async (path: string, cookie: string, body?: unknown) => {
    const res = await app.request(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as View };
  };
  const approve = async (sub = "human-1") => {
    answer = { status: "done", idToken: await token({ sub }) };
  };
  const deny = () => {
    answer = { status: "denied", error: "access_denied" };
  };
  return { db, posted, call, account, approve, deny, checks };
}

describe("verified people's ratings", () => {
  it("a verified account rates at once; it goes to Arkiv with a pseudonym, not the World ID", async () => {
    const { posted, call, account } = await setup();
    const me = await account({ sub: "human-1" });
    expect((await call(me.path, me.cookie)).json).toEqual({
      canRate: true,
      verified: true,
      rating: null,
    });
    const r = await call(me.path, me.cookie, { score: 4 });
    expect(r.json.rating).toMatchObject({ score: 4, status: "posted" });
    expect(r.json.rating?.entity).toContain("rabdi.explorer.arkiv.network/entity/");
    expect(posted).toEqual([
      {
        agent: PRICEGUARD,
        job: ESCROW,
        rater: raterId("test-secret", ISS, "human-1", PRICEGUARD),
        score: 4,
        verified: "world-id",
      },
    ]);
    expect(JSON.stringify(posted)).not.toContain("human-1");
  });

  it("one per person per agent: rating again, even from another account, replaces it", async () => {
    const { db, posted, call, account, approve } = await setup();
    const me = await account({ sub: "human-1" });
    await call(me.path, me.cookie, { score: 5 });
    await call(me.path, me.cookie, { score: 2 });
    const demo = await account({ isDemo: true }); // the same person, in a demo account
    const started = await call(demo.path, demo.cookie, { score: 3 });
    expect(started.status).toBe(201);
    await approve("human-1");
    await vi.waitFor(async () => expect(posted).toHaveLength(3));
    const rows = await db.select().from(ratingRows);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ score: 3, status: "posted" });
    expect(new Set(posted.map((p) => p.rater)).size).toBe(1);
  });

  it("a pseudonym is the same for one agent, and different for each agent and person", () => {
    const a = raterId("s", ISS, "human-1", PRICEGUARD);
    expect(raterId("s", ISS, "human-1", PRICEGUARD.toUpperCase().replace("0X", "0x"))).toBe(a);
    expect(raterId("s", ISS, "human-1", `0x${"cd".repeat(20)}`)).not.toBe(a);
    expect(raterId("s", ISS, "human-2", PRICEGUARD)).not.toBe(a);
    expect(raterId("other secret", ISS, "human-1", PRICEGUARD)).not.toBe(a);
  });

  it("without a World ID on the account: a World ID check first, and nothing is linked to a demo", async () => {
    const { db, posted, call, account, approve, checks } = await setup();
    const demo = await account({ isDemo: true });
    const r = await call(demo.path, demo.cookie, { score: 5 });
    expect(r.json.check?.status).toBe("waiting");
    expect(posted).toHaveLength(0);
    await approve("human-7");
    await vi.waitFor(async () =>
      expect((await checks.get(r.json.check?.id ?? "", demo.user.id))?.status).toBe("verified"),
    );
    expect(posted[0]).toMatchObject({
      score: 5,
      rater: raterId("test-secret", ISS, "human-7", PRICEGUARD),
    });
    expect((await call(demo.path, demo.cookie)).json.rating?.score).toBe(5);
    const [u] = await db.select().from(users).where(eq(users.id, demo.user.id));
    expect(u?.worldSub).toBeNull();
  });

  it("declined in World ID: no rating", async () => {
    const { posted, call, account, deny, checks } = await setup();
    const demo = await account({ isDemo: true });
    const r = await call(demo.path, demo.cookie, { score: 1 });
    deny();
    await vi.waitFor(async () =>
      expect((await checks.get(r.json.check?.id ?? "", demo.user.id))?.status).toBe("denied"),
    );
    expect(posted).toHaveLength(0);
    expect((await call(demo.path, demo.cookie)).json.rating).toBeNull();
  });

  it("only once the job is done, only your own, only 1 to 5", async () => {
    const { call, account } = await setup();
    const held = await account({ sub: "human-1", status: "held" });
    expect((await call(held.path, held.cookie)).json.canRate).toBe(false);
    expect((await call(held.path, held.cookie, { score: 4 })).status).toBe(409);
    const me = await account({ sub: "human-2" });
    const other = await account({ sub: "human-3" });
    expect((await call(me.path, other.cookie, { score: 4 })).status).toBe(404);
    expect((await call(me.path, me.cookie, { score: 6 })).status).toBe(400);
    expect((await call(me.path, "", { score: 4 })).status).toBe(401);
  });

  it("if Arkiv is down, the rating shows as failed, with a note", async () => {
    const { call, account } = await setup({ postFails: true });
    const me = await account({ sub: "human-1" });
    const r = await call(me.path, me.cookie, { score: 4 });
    expect(r.json).toMatchObject({
      rating: { status: "failed" },
      note: "your rating didn't reach Arkiv this time",
    });
  });
});
