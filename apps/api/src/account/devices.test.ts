import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { testDb } from "../test/db";
import { softPasskey } from "../test/passkey";
import type { WalletChain } from "../wallet/chain";
import { walletApprovals } from "../wallet/ops";
import { walletService } from "../wallet/service";

const ORIGIN = "http://localhost:3000";
const site = { rpID: "localhost", origin: ORIGIN, name: "Shikigami" };
type Device = { id: string; onWallet: boolean; label: string | null };
type Prepared = {
  opId: string;
  options: { challenge: string; allowCredentials: { id: string }[] };
};

async function setup() {
  const db = await testDb();
  const ran: string[] = [];
  const chain: WalletChain = {
    addressOf: async (k) => `0x${k.qx.slice(26)}` as `0x${string}`,
    create: async (k) => chain.addressOf(k),
    hederaIdOf: async () => "0.0.900",
    gift: async () => "0xgift",
    balanceOf: async () => 0n,
    allowance: async () => 0n,
    digest: async () => `0x${"ef".repeat(32)}`,
    async execute(_wallet, calls) {
      ran.push(calls[0]?.data.slice(0, 10) ?? "");
      return { hash: "0xdevice" };
    },
  };
  const wallets = walletService(db, chain, { giftUnits: 0n, giftsPerDay: 0, log: () => {} });
  const app = createApp({
    appOrigin: ORIGIN,
    db,
    auth: { site, adminUsers: new Set(), secureCookies: false },
    concierge: async () => ({ text: "", cards: [] }),
    wallets,
    approvals: walletApprovals(db, chain, site),
  });
  const call = (path: string, cookie: string, body?: unknown, method?: string) =>
    app.request(path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "User-Agent": "Macintosh Chrome/140",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";

  // The phone makes the account (and its wallet).
  const phone = softPasskey(ORIGIN);
  const reg = (await (await call("/auth/passkey/register-options", "", {})).json()) as {
    challenge: string;
  };
  const me = cookieOf(
    await call("/auth/passkey/register", "", { response: phone.register(reg.challenge) }),
  );
  for (let i = 0; i < 50; i++) {
    const w = (await (await call("/wallet", me)).json()) as { wallet: { status: string } | null };
    if (w.wallet?.status === "ready") break;
    await new Promise((r) => setTimeout(r, 20));
  }

  /** The laptop joins with a code the phone shows; returns its session. */
  const link = async () => {
    const { code } = (await (await call("/account/devices/link", me, {})).json()) as {
      code: string;
    };
    const laptop = softPasskey(ORIGIN);
    const found = await call("/auth/passkey/link/options", "", { code });
    const { options } = (await found.json()) as {
      options: { challenge: string; excludeCredentials: { id: string }[] };
    };
    expect(options.excludeCredentials.map((c) => c.id)).toEqual([phone.id]);
    const res = await call("/auth/passkey/link", "", {
      code,
      response: laptop.register(options.challenge),
    });
    expect(res.status).toBe(200);
    return { laptop, session: cookieOf(res), code };
  };
  const devices = async () => (await (await call("/account/devices", me)).json()) as Device[];
  /** Face ID on the phone for a device: add or remove. */
  const faceId = async (id: string, action: "add" | "remove") => {
    const prep = await call(`/account/devices/${id}/wallet/face-id`, me, { action });
    if (prep.status !== 200) return prep;
    const { opId, options } = (await prep.json()) as Prepared;
    const offered = options.allowCredentials.map((c) => c.id);
    expect(offered).toContain(phone.id); // a device the wallet trusts approves
    if (action === "add") expect(offered).not.toContain(id); // never the one being let in
    return call(`/account/devices/${id}/wallet`, me, {
      opId,
      response: phone.signIn(options.challenge),
    });
  };
  return { call, me, phone, link, devices, faceId, ran };
}

describe("one account on several devices", () => {
  it("a code lets a new device make its own passkey on the account, once", async () => {
    const { call, me, link, devices } = await setup();
    const { session, code } = await link();
    const meId = ((await (await call("/me", me)).json()) as { id: string }).id;
    expect(((await (await call("/me", session)).json()) as { id: string }).id).toBe(meId);
    expect((await call("/auth/passkey/link/options", "", { code })).status).toBe(410); // used up
    const list = await devices();
    expect(list.map((d) => [d.onWallet, d.label])).toEqual([
      [true, "Mac · Chrome"], // named from the browser at sign-up, too
      [false, "Mac · Chrome"],
    ]);
  });

  it("Face ID on a trusted device lets the new one approve, then shuts it out", async () => {
    const { call, link, devices, faceId, ran } = await setup();
    const { laptop, session } = await link();
    expect((await faceId(laptop.id, "add")).status).toBe(200);
    expect((await devices()).find((d) => d.id === laptop.id)?.onWallet).toBe(true);

    expect((await faceId(laptop.id, "remove")).status).toBe(200);
    expect((await devices()).map((d) => d.id)).not.toContain(laptop.id);
    expect((await call("/me", session)).status).toBe(401); // the lost device is signed out
    expect(ran).toHaveLength(2); // addKey, then removeKey, each run by the wallet
  });

  it("never shuts out the last device that can approve; a sign-in-only one is just forgotten", async () => {
    const { call, me, phone, link, devices, faceId } = await setup();
    expect((await faceId(phone.id, "remove")).status).toBe(409);
    const { laptop } = await link();
    expect((await call(`/account/devices/${phone.id}`, me, undefined, "DELETE")).status).toBe(409);
    expect((await call(`/account/devices/${laptop.id}`, me, undefined, "DELETE")).status).toBe(200);
    expect((await devices()).map((d) => d.id)).toEqual([phone.id]);
  });

  it("a device that removes itself signs out only itself", async () => {
    const { call, me, link, faceId } = await setup();
    const { laptop, session } = await link();
    expect((await faceId(laptop.id, "add")).status).toBe(200);
    // The laptop, now trusted, shuts itself out with its own Face ID.
    const prep = await call(`/account/devices/${laptop.id}/wallet/face-id`, session, {
      action: "remove",
    });
    const { opId, options } = (await prep.json()) as Prepared;
    const res = await call(`/account/devices/${laptop.id}/wallet`, session, {
      opId,
      response: laptop.signIn(options.challenge),
    });
    expect(res.status).toBe(200);
    expect((await call("/me", session)).status).toBe(401); // the laptop is signed out
    expect((await call("/me", me)).status).toBe(200); // the phone isn't
  });
});
