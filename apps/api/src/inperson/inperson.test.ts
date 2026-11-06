import type { MandateClient } from "@app/mandates";
import { counterAt, encodeRequest, fromHex, liveCode, toHex } from "@app/shared";
import type { HederaIds } from "@app/x402";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { users } from "../db/schema";
import { NeedsLimit } from "../hiring/limits";
import { testDb } from "../test/db";
import { liveKeyFor, merchantService } from "./merchants";
import { inPersonPayer } from "./pay";

const WALLET = "0x00000000000000000000000000000000000000aa";

async function setup() {
  const db = await testDb();
  const [shop, payer, demo] = await db
    .insert(users)
    .values([{ displayName: "Shop" }, { displayName: "Payer" }, { isDemo: true }])
    .returning();
  if (!shop || !payer || !demo) throw new Error("no users");
  const wallet = async () => ({ status: "ready", address: WALLET, hederaId: "0.0.4242" });
  const merchants = merchantService(db, wallet);
  const key = privateKeyToAccount(generatePrivateKey());
  const payers = inPersonPayer({
    db,
    registry: {} as MandateClient, // no limit rows yet: the chain isn't asked
    ids: {} as HederaIds,
    concierge: key,
    token: "0x0000000000000000000000000000000000068cda",
    demo: { owner: key, accountId: "0.0.1", caps: { perUser: 1n, total: 1n } },
    ownWallet: wallet,
  });
  return { db, shop, payer, demo, merchants, payers };
}

describe("paying in person", () => {
  it("a merchant's signed request reads back for the payer: who, how much, live or not", async () => {
    const { shop, merchants, payers } = await setup();
    expect(await merchants.become(shop, "Chai Point")).toMatchObject({
      name: "Chai Point",
      account: "0.0.4242",
    });
    const r = await merchants.request(shop, 40);
    const seen = await payers.check(r.frame);
    expect(seen).toMatchObject({
      merchant: { name: "Chai Point", account: "0.0.4242" },
      inr: 40,
      status: "open",
      live: null,
    });
    // The live code from the merchant's screen passes; one from long ago (a screenshot) doesn't.
    const frame = fromHex(r.frame);
    const now = await liveCode(fromHex(r.liveKey), frame, counterAt());
    expect((await payers.check(r.frame, toHex(now))).live).toMatchObject({ ok: true });
    const old = await liveCode(fromHex(r.liveKey), frame, counterAt() - 100);
    expect((await payers.check(r.frame, toHex(old))).live).toMatchObject({ ok: false });
    expect(liveKeyFor("00".repeat(32), r.frame).length).toBe(32);
  });

  it("refuses a request no merchant here made, your own request, and a demo merchant", async () => {
    const { shop, demo, merchants, payers } = await setup();
    await merchants.become(shop, "Chai Point");
    const forged = await encodeRequest(
      { payee: 4242, amount: 40, nonce: 7, expiresAt: Math.floor(Date.now() / 1000) + 60 },
      new Uint8Array(32),
    );
    await expect(payers.check(toHex(forged))).rejects.toThrow(/Not from a merchant/);
    const r = await merchants.request(shop, 40);
    await expect(payers.pay(shop, r.frame, { how: "qr" })).rejects.toThrow(/your own request/);
    await expect(merchants.become(demo, "Fake shop")).rejects.toThrow(/Face ID wallet/);
  });

  it("a passkey payer approves a limit for that merchant with Face ID first; nothing is paid", async () => {
    const { shop, payer, merchants, payers } = await setup();
    await merchants.become(shop, "Chai Point");
    const r = await merchants.request(shop, 40);
    const err = await payers.pay(payer, r.frame, { how: "qr" }).catch((e) => e);
    expect(err).toBeInstanceOf(NeedsLimit);
    expect((err as NeedsLimit).card).toMatchObject({ agentName: "Chai Point", payee: WALLET });
    expect((await merchants.status(shop, r.id))?.status).toBe("open");
  });
});
