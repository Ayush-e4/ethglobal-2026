import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import type { Db } from "../db/client";
import { testDb } from "../test/db";
import { softPasskey } from "../test/passkey";
import type { WalletChain } from "./chain";
import { passkeyKey, walletService } from "./service";

const ORIGIN = "http://localhost:3000";
type Json = Record<string, unknown> & { wallet: Record<string, unknown> | null };

/** Hedera without Hedera: wallets appear at once, with what was gifted to them. */
function fakeChain(failCreate = false) {
  const made = new Set<string>();
  const gifts: { to: string; units: bigint }[] = [];
  const chain: WalletChain = {
    addressOf: async (k) => `0x${k.qx.slice(26)}` as `0x${string}`,
    async create(k) {
      if (failCreate) throw new Error("hashio is down");
      const a = await chain.addressOf(k);
      made.add(a);
      return a;
    },
    hederaIdOf: async (a) => (made.has(a) ? "0.0.4242" : null),
    async gift(to, units) {
      gifts.push({ to, units });
      return "0xgift";
    },
    balanceOf: async (a) => gifts.filter((g) => g.to === a).reduce((s, g) => s + g.units, 0n),
    allowance: async () => 0n,
    digest: async () => `0x${"ab".repeat(32)}`,
    execute: async () => ({ hash: "0xexecuted" }),
  };
  return { chain, made, gifts };
}

async function setup(opts: { giftsPerDay?: number; failCreate?: boolean; db?: Db } = {}) {
  const db = opts.db ?? (await testDb());
  const fake = fakeChain(opts.failCreate);
  const wallets = walletService(db, fake.chain, {
    giftUnits: 100_000n,
    giftsPerDay: opts.giftsPerDay ?? 10,
    log: () => {},
  });
  const app = createApp({
    appOrigin: ORIGIN,
    db,
    auth: {
      site: { rpID: "localhost", origin: ORIGIN, name: "AgentNet" },
      adminUsers: new Set(),
      secureCookies: false,
    },
    concierge: async () => ({ text: "", cards: [] }),
    wallets,
  });
  const call = (path: string, cookie = "", init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { "Content-Type": "application/json", Cookie: cookie } });
  /** Signs up with a new software passkey; returns the session cookie. */
  const signUp = async () => {
    const device = softPasskey(ORIGIN);
    const reg = (await (
      await call("/auth/passkey/register-options", "", { method: "POST", body: "{}" })
    ).json()) as { challenge: string };
    const res = await call("/auth/passkey/register", "", {
      method: "POST",
      body: JSON.stringify({ response: device.register(reg.challenge) }),
    });
    return res.headers.get("set-cookie")?.split(";")[0] ?? "";
  };
  const wallet = async (cookie: string) => (await (await call("/wallet", cookie)).json()) as Json;
  /** Waits for the wallet being made in the background after sign-up. */
  const settled = async (cookie: string) => {
    for (let i = 0; i < 50; i++) {
      const w = await wallet(cookie);
      if (w.wallet && w.wallet.status !== "creating") return w;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("the wallet never settled");
  };
  return { db, app, call, signUp, wallet, settled, wallets, ...fake };
}

describe("Face ID wallets", () => {
  it("signing up with a passkey makes a wallet, with a little test USDC", async () => {
    const { signUp, settled, made } = await setup();
    const w = await settled(await signUp());
    expect(w).toMatchObject({
      demo: false,
      wallet: { status: "ready", hederaId: "0.0.4242", usdcUnits: "100000", giftUnits: "100000" },
    });
    expect(made.size).toBe(1);
  });

  it("demo accounts get none: they spend from the shared demo wallet", async () => {
    const { call } = await setup();
    const res = await call("/auth/demo", "", { method: "POST" });
    const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(await (await call("/wallet", cookie)).json()).toEqual({ demo: true, wallet: null });
  });

  it("gifts stop at the daily cap, and never go out twice", async () => {
    const { signUp, settled, gifts, wallets, db } = await setup({ giftsPerDay: 1 });
    const first = await signUp();
    await settled(first);
    const second = await settled(await signUp());
    expect(second.wallet).toMatchObject({ status: "ready", giftUnits: null, usdcUnits: "0" });
    // Making the first one again (say, after a restart) doesn't gift it again.
    const { users } = await import("../db/schema");
    const all = await db.select().from(users);
    for (const u of all) await wallets.ensure(u.id);
    expect(gifts).toHaveLength(1);
  });

  it("a failed try shows as failed, and the next visit tries again", async () => {
    const db = await testDb();
    const broken = await setup({ failCreate: true, db });
    const cookie = await broken.signUp();
    expect((await broken.settled(cookie)).wallet?.status).toBe("failed");
    const fixed = await setup({ db }); // Hedera is back
    await fixed.wallet(cookie); // a visit starts another try
    expect((await fixed.settled(cookie)).wallet?.status).toBe("ready");
  });

  it("signed out is 401", async () => {
    const { call } = await setup();
    expect((await call("/wallet")).status).toBe(401);
  });
});

describe("passkeyKey", () => {
  it("refuses a key that isn't P-256", () => {
    expect(() => passkeyKey("oQEC")).toThrow(); // COSE {1: 2} with no algorithm
  });
});
