import type { KeySig } from "@app/mandates";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { limits, quotes } from "../db/schema";
import { testDb } from "../test/db";
import { softPasskey } from "../test/passkey";
import type { WalletChain } from "../wallet/chain";
import { walletApprovals } from "../wallet/ops";
import { passkeyKey, walletService } from "../wallet/service";
import { limitParams } from "./limits";
import type { HiringService } from "./service";

const ORIGIN = "http://localhost:3000";
const site = { rpID: "localhost", origin: ORIGIN, name: "AgentNet" };
const PAYEE = "0x00000000000000000000000000000000000000a7";
const REGISTRY = "0x00000000000000000000000000000000000000f1";
const CONCIERGE = "0x00000000000000000000000000000000000000c0";
const USDC = "0x0000000000000000000000000000000000068cda";

async function setup() {
  const db = await testDb();
  const ran: { wallet: string; sig: KeySig }[] = [];
  const chain: WalletChain = {
    addressOf: async (k) => `0x${k.qx.slice(26)}` as `0x${string}`,
    create: async (k) => chain.addressOf(k),
    hederaIdOf: async () => "0.0.777",
    gift: async () => "0xgift",
    balanceOf: async () => 100_000n,
    allowance: async () => 0n,
    digest: async () => `0x${"cd".repeat(32)}`,
    async execute(wallet, _calls, _deadline, sig) {
      ran.push({ wallet, sig });
      return { hash: "0xlimit", mandateId: 42n };
    },
  };
  const wallets = walletService(db, chain, { giftUnits: 0n, giftsPerDay: 0, log: () => {} });
  const hiring = {
    newLimit: (payee: `0x${string}`) => limitParams(CONCIERGE, USDC, payee),
    registryAddress: REGISTRY,
  } as unknown as HiringService;
  const app = createApp({
    appOrigin: ORIGIN,
    db,
    auth: { site, adminUsers: new Set(), secureCookies: false },
    concierge: async () => ({ text: "", cards: [] }),
    hiring,
    wallets,
    walletChain: chain,
    approvals: walletApprovals(db, chain, site),
  });
  const call = (path: string, cookie: string, body?: unknown) =>
    app.request(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const device = softPasskey(ORIGIN);
  const reg = (await (await call("/auth/passkey/register-options", "", {})).json()) as {
    challenge: string;
  };
  const signedUp = await call("/auth/passkey/register", "", {
    response: device.register(reg.challenge),
  });
  const me = signedUp.headers.get("set-cookie")?.split(";")[0] ?? "";
  for (let i = 0; i < 50; i++) {
    const w = (await (await call("/wallet", me)).json()) as { wallet: { status: string } | null };
    if (w.wallet?.status === "ready") break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const chat = (await (await call("/chats", me, {})).json()) as { id: string };
  await db.insert(quotes).values({
    key: `0x${"11".repeat(32)}`,
    chatId: chat.id,
    agentName: "StayWise",
    agentAddress: PAYEE,
    endpoint: "http://agent",
    feeUnits: 20_000n,
    summary: "Park Inn · 14–16 Dec",
    expiresAt: new Date(Date.now() + 60_000),
  });
  return { db, call, me, chat, device, ran };
}

type Prepared = {
  opId: string;
  options: { challenge: string; allowCredentials: { id: string }[] };
};

describe("Face ID spending limits", () => {
  it("the device signs the batch's digest; the wallet sets the limit; it's saved for the chat", async () => {
    const { db, call, me, chat, device, ran } = await setup();
    const prep = await call(`/chats/${chat.id}/limits/face-id`, me, { payee: PAYEE });
    expect(prep.status).toBe(200);
    const { opId, options } = (await prep.json()) as Prepared;
    expect(options.challenge).toBe(Buffer.from("cd".repeat(32), "hex").toString("base64url"));
    expect(options.allowCredentials.map((c) => c.id)).toEqual([device.id]);

    const done = await call(`/chats/${chat.id}/limits`, me, {
      opId,
      response: device.signIn(options.challenge),
    });
    expect(done.status).toBe(201);
    expect(await done.json()).toMatchObject({ mandateId: "42", tx: "0xlimit" });
    // The wallet was handed the device's own key and answer.
    const [passkey] = await db.query.passkeys.findMany();
    expect({ qx: ran[0]?.sig.qx, qy: ran[0]?.sig.qy }).toEqual(
      passkeyKey(passkey?.publicKey ?? ""),
    );
    const [limit] = await db.select().from(limits);
    expect(limit).toMatchObject({
      chatId: chat.id,
      payee: PAYEE,
      ownerAccount: "0.0.777",
      demo: false,
    });

    const live = (await (await call(`/chats/${chat.id}/limits`, me)).json()) as { payee: string }[];
    expect(live.map((l) => l.payee)).toEqual([PAYEE]);

    // Each approval works once.
    const again = await call(`/chats/${chat.id}/limits`, me, {
      opId,
      response: device.signIn(options.challenge),
    });
    expect(again.status).toBe(409);
  });

  it("refuses an answer made for another site", async () => {
    const { call, me, chat, device, ran } = await setup();
    const { opId, options } = (await (
      await call(`/chats/${chat.id}/limits/face-id`, me, { payee: PAYEE })
    ).json()) as Prepared;
    const phishing = softPasskey("https://evil.test");
    const answer = { ...phishing.signIn(options.challenge), id: device.id };
    const res = await call(`/chats/${chat.id}/limits`, me, { opId, response: answer });
    expect(res.status).toBe(409);
    expect(ran).toHaveLength(0);
  });

  it("only for an agent that quoted in this chat, and only with your own wallet", async () => {
    const { call, me, chat } = await setup();
    const stranger = "0x00000000000000000000000000000000000000ee";
    expect((await call(`/chats/${chat.id}/limits/face-id`, me, { payee: stranger })).status).toBe(
      409,
    );
    const demo = await call("/auth/demo", "", {});
    const demoCookie = demo.headers.get("set-cookie")?.split(";")[0] ?? "";
    const theirs = (await (await call("/chats", demoCookie, {})).json()) as { id: string };
    const res = await call(`/chats/${theirs.id}/limits/face-id`, demoCookie, { payee: PAYEE });
    expect(res.status).toBe(409);
    expect(
      (await call(`/chats/${chat.id}/limits/face-id`, demoCookie, { payee: PAYEE })).status,
    ).toBe(404);
  });
});
