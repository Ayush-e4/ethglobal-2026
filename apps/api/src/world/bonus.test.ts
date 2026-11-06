import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { createSession } from "../auth/session";
import type { Db } from "../db/client";
import { users, wallets as walletRows } from "../db/schema";
import { testDb } from "../test/db";
import { fakeWorld, token } from "../test/world";
import type { WalletChain } from "../wallet/chain";
import { walletService } from "../wallet/service";
import { worldBonus } from "./bonus";
import { worldChecks } from "./checks";
import type { Poll } from "./oidc";
import { onWorldVerified } from "./on-verified";

const ORIGIN = "http://localhost:3000";
type World = {
  available: boolean;
  verified?: boolean;
  bonus?: { units: string; status: string; tx: string | null } | null;
  check?: { id: string; status: string; reason?: string; userCode: string; link: string } | null;
};

async function setup(o: { perDay?: number; giftFails?: boolean; noWorld?: boolean } = {}) {
  const db: Db = await testDb();
  const gifts: { to: string; units: bigint }[] = [];
  const chain = {
    async gift(to: string, units: bigint) {
      if (o.giftFails) throw new Error("hashio is down");
      gifts.push({ to, units });
      return "0xgift" as const;
    },
  } as unknown as WalletChain;
  let answer: Poll = { status: "pending" }; // what World says on the next poll
  const wallets = walletService(db, chain, { giftUnits: 0n, giftsPerDay: 0, log: () => {} });
  const bonus = worldBonus(db, chain, wallets, { units: 200_000n, perDay: o.perDay ?? 20 });
  const tick = () => new Promise<void>((r) => setTimeout(r, 2));
  const checks = o.noWorld
    ? null
    : worldChecks(
        db,
        await fakeWorld(async () => answer),
        onWorldVerified({ bonus, ratings: null }),
        tick,
        () => {},
      );
  const app = createApp({
    appOrigin: ORIGIN,
    db,
    auth: {
      site: { rpID: "localhost", origin: ORIGIN, name: "Shikigami" },
      adminUsers: new Set(),
      secureCookies: false,
    },
    concierge: async () => ({ text: "", cards: [] }),
    wallets,
    world: { checks, bonus, minFeeUnits: 50_000n },
  });
  /** A signed-in account; a passkey account with its wallet ready, unless it's a demo. */
  const account = async (isDemo = false) => {
    const [u] = await db.insert(users).values({ isDemo }).returning();
    const id = u?.id ?? "";
    const address = `0x${id.replaceAll("-", "").padEnd(40, "0")}`;
    if (!isDemo) await db.insert(walletRows).values({ userId: id, address, status: "ready" });
    return { address, userId: id, cookie: `app_session=${await createSession(db, id)}` };
  };
  const call = (path: string, cookie: string, method = "GET") =>
    app.request(path, { method, headers: { Cookie: cookie } });
  const world = async (cookie: string) => (await (await call("/world", cookie)).json()) as World;
  /** Asks for the bonus, World answers `result`, and waits for the check to end. */
  const prove = async (cookie: string, result: () => Promise<Poll>) => {
    answer = { status: "pending" };
    const res = await call("/world/bonus", cookie, "POST");
    if (!res.ok) return { status: res.status, world: await world(cookie) };
    answer = await result();
    await vi.waitFor(async () => expect((await world(cookie)).check?.status).not.toBe("waiting"));
    return { status: res.status, world: await world(cookie) };
  };
  const approved = async (sub = "human-1"): Promise<Poll> => ({
    status: "done",
    idToken: await token({ sub }),
  });
  return {
    db,
    call,
    world,
    account,
    prove,
    approved,
    gifts,
    checks,
    setAnswer: (p: Poll) => {
      answer = p;
    },
  };
}

describe("the World ID welcome bonus", () => {
  it("a person proves it with World App and gets the bonus in their wallet, once", async () => {
    const { account, call, world, prove, approved, gifts } = await setup();
    const me = await account();
    expect(await world(me.cookie)).toMatchObject({ available: true, verified: false, bonus: null });

    const started = await call("/world/bonus", me.cookie, "POST");
    expect(started.status).toBe(201);
    const { check } = (await started.json()) as { check: World["check"] };
    expect(check).toMatchObject({ status: "waiting", userCode: "ABCD-EFGH" });
    expect(JSON.stringify(check)).not.toContain("private-device-code");
    // Asking again while it waits gives the same check, not a second one.
    const again = (await (await call("/world/bonus", me.cookie, "POST")).json()) as World;
    expect(again.check?.id).toBe(check?.id);

    const { world: after } = await prove(me.cookie, () => approved());
    expect(after).toMatchObject({
      verified: true,
      bonus: { units: "200000", status: "sent", tx: "0xgift" },
      check: { status: "verified" },
    });
    expect(gifts).toEqual([{ to: me.address, units: 200_000n }]);
    expect((await call("/world/bonus", me.cookie, "POST")).status).toBe(409); // had it
  });

  it("a second account with the same World ID gets nothing", async () => {
    const { account, prove, approved, gifts } = await setup();
    await prove((await account()).cookie, () => approved());
    const second = await account();
    const { world } = await prove(second.cookie, () => approved());
    expect(world).toMatchObject({
      verified: false,
      bonus: null,
      check: { status: "mismatch", reason: "this World ID is linked to another account" },
    });
    expect(gifts).toHaveLength(1);
  });

  it("denied in World App: nothing is sent, and they can try again", async () => {
    const { account, prove, approved, gifts } = await setup();
    const me = await account();
    const denied = await prove(me.cookie, async () => ({
      status: "denied",
      error: "access_denied",
    }));
    expect(denied.world).toMatchObject({
      verified: false,
      bonus: null,
      check: { status: "denied" },
    });
    expect(gifts).toHaveLength(0);
    expect((await prove(me.cookie, () => approved())).world.bonus?.status).toBe("sent");
  });

  it("past the daily cap, the person is verified and told to come back", async () => {
    const { account, prove, approved, gifts } = await setup({ perDay: 0 });
    const { world } = await prove((await account()).cookie, () => approved());
    expect(world).toMatchObject({
      verified: true,
      bonus: null,
      check: {
        status: "verified",
        reason: "today's bonuses are all given out: try again tomorrow",
      },
    });
    expect(gifts).toHaveLength(0);
  });

  it("a send that fails shows as failed and is never sent again", async () => {
    const { account, call, prove, approved } = await setup({ giftFails: true });
    const me = await account();
    const { world } = await prove(me.cookie, () => approved());
    expect(world).toMatchObject({
      bonus: { status: "failed", tx: null },
      check: { reason: "the bonus didn't go through" },
    });
    expect((await call("/world/bonus", me.cookie, "POST")).status).toBe(409);
  });

  it("approving a payment with World ID never sends the bonus", async () => {
    const { db, account, world, gifts, checks, setAnswer, approved } = await setup();
    const me = await account();
    const [u] = await db.select().from(users).where(eq(users.id, me.userId));
    if (!checks || !u) throw new Error("setup");
    setAnswer(await approved());
    const c = await checks.start(u.id, "spend", "chat:payee:50000");
    await vi.waitFor(async () => expect((await checks.get(c.id, u.id))?.status).toBe("verified"));
    expect(await world(me.cookie)).toMatchObject({ verified: true, bonus: null });
    expect(gifts).toHaveLength(0);
  });

  it("demo accounts have no wallet of their own, so no bonus", async () => {
    const { account, call } = await setup();
    expect((await call("/world/bonus", (await account(true)).cookie, "POST")).status).toBe(409);
  });

  it("without World ID set up, the app says so", async () => {
    const { account, call, world } = await setup({ noWorld: true });
    const me = await account();
    expect(await world(me.cookie)).toEqual({ available: false });
    expect((await call("/world/bonus", me.cookie, "POST")).status).toBe(503);
  });

  it("signed out is 401", async () => {
    const { call } = await setup();
    expect((await call("/world", "")).status).toBe(401);
    expect((await call("/world/bonus", "", "POST")).status).toBe(401);
  });
});
