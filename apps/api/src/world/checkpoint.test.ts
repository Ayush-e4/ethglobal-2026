import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createSession } from "../auth/session";
import type { Db } from "../db/client";
import { chats, worldChecks as checkRows, quotes, users } from "../db/schema";
import { testDb } from "../test/db";
import { fakeWorld, ISS, token } from "../test/world";
import { approvalRoutes } from "./approval-routes";
import { hireTotal, humanCheckpoint, NeedsHuman } from "./checkpoint";
import { worldChecks } from "./checks";
import type { Poll } from "./oidc";

const KEY = `0x${"ab".repeat(32)}`;
const OTHER = `0x${"cd".repeat(32)}`;
const PRICEGUARD = `0x${"11".repeat(20)}`;
const STAYWISE = `0x${"22".repeat(20)}`;
type Check = { id: string; status: string; reason?: string; used: boolean; userCode: string };

async function setup() {
  const db: Db = await testDb();
  let answer: Poll = { status: "pending" };
  const tick = () => new Promise<void>((r) => setTimeout(r, 2));
  const onVerified = async () => undefined;
  const checks = worldChecks(db, await fakeWorld(async () => answer), onVerified, tick, () => {});
  const gate = humanCheckpoint(checks, 50_000n); // from 0.05 USDC
  const app = approvalRoutes(db, checks, 50_000n);

  /** An account with a chat holding PriceGuard's quote (0.05) and StayWise's (0.02). */
  const account = async (isDemo = false, withQuotes = true) => {
    const [user] = await db.insert(users).values({ isDemo }).returning();
    if (!user) throw new Error("no user");
    const [chat] = await db.insert(chats).values({ userId: user.id, title: "Goa" }).returning();
    if (!chat) throw new Error("no chat");
    const quote = (key: string, agentName: string, feeUnits: bigint) => ({
      key,
      chatId: chat.id,
      agentName,
      agentAddress: agentName === "PriceGuard" ? PRICEGUARD : STAYWISE,
      endpoint: "http://localhost:8802",
      feeUnits,
      summary: `${agentName} · Goa · 20–22 Dec`,
      expiresAt: new Date(Date.now() + 600_000),
    });
    if (withQuotes)
      await db
        .insert(quotes)
        .values([quote(KEY, "PriceGuard", 50_000n), quote(OTHER, "StayWise", 20_000n)]);
    const cookie = `app_session=${await createSession(db, user.id)}`;
    return { user, chat, cookie };
  };
  const call = (path: string, cookie: string, body?: unknown) =>
    app.request(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  /** Starts an approval on the card, World answers `result`; resolves when the check ended. */
  const approve = async (a: Awaited<ReturnType<typeof account>>, result: () => Promise<Poll>) => {
    answer = { status: "pending" };
    const res = await call(`/chats/${a.chat.id}/human-checks`, a.cookie, { quoteKey: KEY });
    const { check } = (await res.json()) as { check: Check };
    answer = await result();
    await vi.waitFor(async () => {
      const now = (await (await call(`/world/checks/${check.id}`, a.cookie)).json()) as {
        check: Check;
      };
      expect(now.check.status).not.toBe("waiting");
    });
    return { status: res.status, check };
  };
  const approved = async (sub = "human-1"): Promise<Poll> => ({
    status: "done",
    idToken: await token({ sub }),
  });
  const quoteOf = (
    key: string,
    agentName: string,
    feeUnits: bigint,
    agentAddress = PRICEGUARD,
  ) => ({
    key,
    agentName,
    agentAddress,
    feeUnits,
    summary: `${agentName} · Goa`,
  });
  return { db, gate, call, account, approve, approved, quoteOf, checks };
}

describe("the human checkpoint before larger hires", () => {
  it("a smaller hire goes ahead without one", async () => {
    const { gate, account, quoteOf } = await setup();
    const { user, chat } = await account();
    expect(await gate(user, chat.id, quoteOf(OTHER, "StayWise", 20_000n))).toBeNull();
  });

  it("a cheap agent booking an expensive stay is a larger payment too: fee plus trip price", async () => {
    const { db, call, account } = await setup();
    const a = await account();
    expect(hireTotal({ feeUnits: 20_000n, priceUnits: 58_000n })).toBe(78_000n);
    const big = `0x${"7".repeat(64)}`;
    await db.insert(quotes).values({
      key: big,
      chatId: a.chat.id,
      agentName: "StayWise",
      agentAddress: STAYWISE,
      endpoint: "http://localhost:8801",
      feeUnits: 20_000n, // under the 0.05 line on its own
      priceUnits: 58_000n, // a ₹58,000 stay, at testnet scale
      summary: "StayWise · a ₹58,000 stay",
      expiresAt: new Date(Date.now() + 600_000),
    });
    const res = await call(`/chats/${a.chat.id}/human-checks`, a.cookie, { quoteKey: big });
    expect(res.status).not.toBe(409); // it needs a person
    const small = await call(`/chats/${a.chat.id}/human-checks`, a.cookie, { quoteKey: OTHER });
    expect(small.status).toBe(409); // StayWise's fee alone, no trip price: no check
  });

  it("a larger one asks for World ID first, with a card for that very quote", async () => {
    const { gate, account, quoteOf } = await setup();
    const { user, chat } = await account();
    const err = await gate(user, chat.id, quoteOf(KEY, "PriceGuard", 50_000n)).catch((e) => e);
    expect(err).toBeInstanceOf(NeedsHuman);
    expect((err as NeedsHuman).card).toMatchObject({
      type: "human",
      agentName: "PriceGuard",
      feeUnits: "50000",
      quoteKey: KEY,
    });
  });

  it("once a person approves, that quote can be paid, once", async () => {
    const { gate, account, approve, approved, quoteOf, call } = await setup();
    const a = await account();
    const { status, check } = await approve(a, () => approved());
    expect(status).toBe(201);
    const pass = await gate(a.user, a.chat.id, quoteOf(KEY, "PriceGuard", 50_000n));
    expect(pass).not.toBeNull();
    // Asked again before paying (a Face ID step in between): still there.
    const again = await gate(a.user, a.chat.id, quoteOf(KEY, "PriceGuard", 50_000n));
    expect(again).not.toBeNull();
    expect(await pass?.use()).toBe(true);
    expect(await again?.use()).toBe(false); // two hires at once: only one pays
    await expect(gate(a.user, a.chat.id, quoteOf(KEY, "PriceGuard", 50_000n))).rejects.toThrow(
      NeedsHuman,
    );
    const read = (await (await call(`/world/checks/${check.id}`, a.cookie)).json()) as {
      check: Check;
    };
    expect(read.check).toMatchObject({ status: "verified", used: true });
  });

  it.each([
    ["declined in the World ID app", { status: "denied", error: "access_denied" }, "denied"],
    ["left to time out", { status: "expired", error: "expired_token" }, "expired"],
  ] as const)("%s: nothing can be paid", async (_, result, status) => {
    const { gate, account, approve, quoteOf, call } = await setup();
    const a = await account();
    const { check } = await approve(a, async () => result as Poll);
    const read = (await (await call(`/world/checks/${check.id}`, a.cookie)).json()) as {
      check: Check;
    };
    expect(read.check.status).toBe(status);
    await expect(gate(a.user, a.chat.id, quoteOf(KEY, "PriceGuard", 50_000n))).rejects.toThrow(
      NeedsHuman,
    );
  });

  it("an approval covers that agent at that fee (a fresh quote too), and goes stale after 10 minutes", async () => {
    const { db, gate, account, approve, approved, quoteOf } = await setup();
    const a = await account();
    await approve(a, () => approved());
    const fresh = `0x${"ef".repeat(32)}`; // quotes last minutes: a new one from PriceGuard
    expect(await gate(a.user, a.chat.id, quoteOf(fresh, "PriceGuard", 50_000n))).not.toBeNull();
    await expect(
      gate(a.user, a.chat.id, quoteOf(OTHER, "Other", 60_000n, `0x${"33".repeat(20)}`)),
    ).rejects.toThrow(NeedsHuman);
    await expect(gate(a.user, a.chat.id, quoteOf(KEY, "PriceGuard", 90_000n))).rejects.toThrow(
      NeedsHuman,
    );
    await db.update(checkRows).set({ endedAt: new Date(Date.now() - 11 * 60_000) });
    await expect(gate(a.user, a.chat.id, quoteOf(KEY, "PriceGuard", 50_000n))).rejects.toThrow(
      NeedsHuman,
    );
  });

  it("demo accounts: any verified person approves, and nothing is linked to the throwaway account", async () => {
    const { db, gate, account, approve, approved, quoteOf } = await setup();
    await db.insert(users).values({ worldIss: ISS, worldSub: "human-1" }); // their passkey account
    const demo = await account(true);
    await approve(demo, () => approved());
    expect(await gate(demo.user, demo.chat.id, quoteOf(KEY, "PriceGuard", 50_000n))).not.toBeNull();
    const [me] = await db.select().from(users).where(eq(users.id, demo.user.id));
    expect(me?.worldSub).toBeNull();
  });

  it("passkey accounts: a different World ID than the account's can't approve", async () => {
    const { db, gate, account, approve, approved, quoteOf } = await setup();
    const a = await account();
    await db
      .update(users)
      .set({ worldIss: ISS, worldSub: "human-1" })
      .where(eq(users.id, a.user.id));
    await approve(a, () => approved("human-2"));
    await expect(gate(a.user, a.chat.id, quoteOf(KEY, "PriceGuard", 50_000n))).rejects.toThrow(
      NeedsHuman,
    );
  });
});

describe("approval routes", () => {
  it("the card can start an approval after its quote expired (the agent and fee still hold)", async () => {
    const { db, account, call } = await setup();
    const a = await account();
    await db.update(quotes).set({ expiresAt: new Date(Date.now() - 60_000) });
    const res = await call(`/chats/${a.chat.id}/human-checks`, a.cookie, { quoteKey: KEY });
    expect(res.status).toBe(201);
    const found = (await (
      await call(`/chats/${a.chat.id}/human-checks/${KEY}`, a.cookie)
    ).json()) as {
      check: Check | null;
    };
    expect(found.check?.status).toBe("waiting");
  });

  it("only for a quote in your own chat, and only when it needs one", async () => {
    const { account, call } = await setup();
    const a = await account();
    const b = await account(false, false); // someone else
    expect(
      (await call(`/chats/${a.chat.id}/human-checks`, b.cookie, { quoteKey: KEY })).status,
    ).toBe(404);
    expect(
      (await call(`/chats/${a.chat.id}/human-checks`, a.cookie, { quoteKey: OTHER })).status,
    ).toBe(409);
    expect(
      (await call(`/chats/${a.chat.id}/human-checks`, a.cookie, { quoteKey: "nope" })).status,
    ).toBe(400);
    expect((await call(`/chats/${a.chat.id}/human-checks`, "", { quoteKey: KEY })).status).toBe(
      401,
    );
  });

  it("one check at a time per quote; others can't read it; a reopened card finds it", async () => {
    const { account, call } = await setup();
    const a = await account();
    const b = await account(false, false); // someone else
    const first = (await (
      await call(`/chats/${a.chat.id}/human-checks`, a.cookie, { quoteKey: KEY })
    ).json()) as { check: Check };
    const second = (await (
      await call(`/chats/${a.chat.id}/human-checks`, a.cookie, { quoteKey: KEY })
    ).json()) as { check: Check };
    expect(second.check.id).toBe(first.check.id);
    expect(JSON.stringify(first)).not.toContain("private-device-code");
    expect((await call(`/world/checks/${first.check.id}`, b.cookie)).status).toBe(404);
    const found = (await (
      await call(`/chats/${a.chat.id}/human-checks/${KEY}`, a.cookie)
    ).json()) as { check: Check | null };
    expect(found.check?.id).toBe(first.check.id);
  });
});
