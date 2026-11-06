import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "../db/client";
import { chats, dealClaims, hires, users } from "../db/schema";
import { testDb } from "../test/db";
import type { Drop } from "./drops";
import type { IdkitConfig } from "./idkit";
import { dealService } from "./service";

const IDKIT: IdkitConfig = {
  appId: "app_staging_test",
  rpId: "rp_test",
  signingKey: "11".repeat(32),
  environment: "staging",
  verifyUrl: "https://developer.world.org/api/v4/verify/rp_test",
};
const DROP: Drop = {
  id: "test-drop",
  title: "Fee back",
  detail: "",
  total: 2,
  maxFeeUnits: 50_000n,
  endsAt: new Date(Date.now() + 86_400_000),
};
const proof = (signal: string, nullifier = "42", over: Record<string, unknown> = {}) => ({
  protocol_version: "4.0",
  nonce: "n",
  action: "deal-test-drop",
  environment: "staging",
  responses: [
    {
      identifier: "proof_of_human",
      proof: ["1", "2", "3", "4", "5"],
      nullifier,
      signal_hash: hashSignal(signal),
      issuer_schema_id: 1,
      expires_at_min: 0,
    },
  ],
  ...over,
});

async function setup(o: { worldSays?: boolean; total?: number } = {}) {
  const db: Db = await testDb();
  const account = async () => {
    const [u] = await db.insert(users).values({}).returning();
    if (!u) throw new Error("no user");
    return u;
  };
  const verified: unknown[] = [];
  const gifts: [string, bigint][] = [];
  const said: string[] = [];
  const deals = dealService(db, {
    idkit: IDKIT,
    wallets: {
      get: async () =>
        ({ status: "ready", address: "0x000000000000000000000000000000000000bEEF" }) as never,
    },
    chain: {
      gift: async (to, units) => {
        gifts.push([to, units]);
        return "0xpaid";
      },
    },
    chats: {
      add: async (_c, _r, text) => {
        said.push(text);
        return {} as never;
      },
    },
    drops: [{ ...DROP, total: o.total ?? DROP.total }],
    fetchImpl: vi.fn(async (_url: string, init: { body: string }) => {
      verified.push(JSON.parse(init.body));
      return Response.json({ success: o.worldSays ?? true });
    }) as never,
    log: () => {},
  });
  return { db, deals, account, verified, gifts, said };
}

describe("deal drops: one per person, with World ID", () => {
  it("signs the request on our server, bound to the account", async () => {
    const { deals, account } = await setup();
    const u = await account();
    const s = await deals.start(u, DROP.id);
    expect(s).toMatchObject({
      app_id: "app_staging_test",
      action: "deal-test-drop",
      environment: "staging",
      signal: u.id,
    });
    expect(s.rp_context).toMatchObject({ rp_id: "rp_test" });
    expect(s.rp_context.signature).toMatch(/^0x[0-9a-f]+$/);
  });

  it("a person claims once: not again on this account, and not from another account", async () => {
    const { deals, account, verified } = await setup();
    const [a, b] = [await account(), await account()];
    expect((await deals.claim(a, DROP.id, proof(a.id))).status).toBe("claimed");
    expect(verified).toHaveLength(1);
    await expect(deals.claim(a, DROP.id, proof(a.id))).rejects.toThrow(/claimed this one already/);
    // The same World ID (the same nullifier) on another account.
    await expect(deals.claim(b, DROP.id, proof(b.id, "42"))).rejects.toThrow(/one per person/);
  });

  it.each([
    ["made for another account", (id: string) => proof(`${id}-other`), /for someone else/],
    [
      "from the wrong environment",
      (id: string) => proof(id, "42", { environment: "production" }),
      /wrong World ID environment/,
    ],
    [
      "for another action",
      (id: string) => proof(id, "42", { action: "deal-other" }),
      /another action/,
    ],
    [
      "in the older 3.0 format (another nullifier for the same person)",
      (id: string) => proof(id, "42", { protocol_version: "3.0" }),
      /Only World ID 4.0/,
    ],
  ])("refuses a proof %s", async (_, make, why) => {
    const { deals, account } = await setup();
    const u = await account();
    await expect(deals.claim(u, DROP.id, make(u.id))).rejects.toThrow(why);
  });

  it("refuses what World doesn't accept, and a drop that's all claimed", async () => {
    const no = await setup({ worldSays: false });
    const u = await no.account();
    await expect(no.deals.claim(u, DROP.id, proof(u.id))).rejects.toThrow(/World didn't accept/);
    const one = await setup({ total: 1 });
    const [a, b] = [await one.account(), await one.account()];
    await one.deals.claim(a, DROP.id, proof(a.id, "1"));
    await expect(one.deals.start(b, DROP.id)).rejects.toThrow(/All claimed/);
    expect((await one.deals.list(b))[0]).toMatchObject({ left: 0, mine: null });
  });

  it("pays back the next booking's fee once its agent is paid, and only once", async () => {
    const { db, deals, account, gifts, said } = await setup();
    const u = await account();
    await deals.claim(u, DROP.id, proof(u.id));
    const [chat] = await db.insert(chats).values({ userId: u.id, title: "Goa" }).returning();
    const [hire] = await db
      .insert(hires)
      .values({
        chatId: chat?.id ?? "",
        userId: u.id,
        quoteKey: "k",
        agentName: "SkyHop",
        title: "Air India · BOM → GOI",
        feeUnits: 30_000n,
        status: "released",
      })
      .returning();
    if (!hire) throw new Error("no hire");
    await deals.onReleased(hire);
    await deals.onReleased(hire);
    expect(gifts).toEqual([["0x000000000000000000000000000000000000bEEF", 30_000n]]);
    expect(said[0]).toMatch(/paid back SkyHop's 0\.03 USDC fee/);
    const [c] = await db.select().from(dealClaims).where(eq(dealClaims.userId, u.id));
    expect(c).toMatchObject({ status: "paid", hireId: hire.id, payTx: "0xpaid" });
  });
});
