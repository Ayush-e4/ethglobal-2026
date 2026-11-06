import { cardMessage, voidCardMessage } from "@app/shared";
import { eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import type { Db } from "../db/client";
import { chats, hires, users } from "../db/schema";
import { testDb } from "../test/db";
import { cardIssuer } from "./issuer";

const agent = privateKeyToAccount(generatePrivateKey());
const ESCROW = `0x${"e5".repeat(32)}`;

async function setup(escrow: { state: string; payee: string; amount: bigint }) {
  const db: Db = await testDb();
  const [u] = await db.insert(users).values({}).returning();
  const [chat] = await db
    .insert(chats)
    .values({ userId: u?.id ?? "", title: "Goa" })
    .returning();
  await db.insert(hires).values({
    chatId: chat?.id ?? "",
    userId: u?.id ?? "",
    quoteKey: "k",
    agentName: "StayWise",
    title: "Park Inn",
    feeUnits: 20_000n,
    priceUnits: 12_347n,
    status: "held",
    escrowId: ESCROW,
  });
  const issuer = cardIssuer(db, { getEscrow: async () => escrow } as never);
  const issue = async (amountUnits = "12347", who = agent) =>
    issuer.routes.request("/cards/issue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        escrowId: ESCROW,
        merchant: "Park Inn",
        amount: 12347,
        currency: "INR",
        amountUnits,
        agent: agent.address,
        signature: await who.signMessage({ message: cardMessage(ESCROW, amountUnits, "Park Inn") }),
      }),
    });
  const hire = async () => (await db.select().from(hires).where(eq(hires.escrowId, ESCROW)))[0];
  return { db, issuer, issue, hire };
}

describe("Shikigami Cards (mock issuer)", () => {
  it("issues a one-time card only for a funded escrow, signed by its agent; it shows on the hire", async () => {
    const s = await setup({ state: "held", payee: agent.address, amount: 32_347n });
    expect((await s.issue("12347", privateKeyToAccount(generatePrivateKey()))).status).toBe(403);
    expect((await s.issue("99999999")).status).toBe(409); // more than the escrow holds
    const r = await s.issue();
    expect(r.status).toBe(200);
    const card = (await r.json()) as {
      last4: string;
      number: string;
      status: string;
      merchant: string;
    };
    expect(card).toMatchObject({ status: "authorized", merchant: "Park Inn" });
    expect(card.number.endsWith(card.last4)).toBe(true);
    expect((await s.hire())?.card).toMatchObject({
      last4: card.last4,
      status: "authorized",
      amount: 12347,
    });
    // Asked again (a retry): the same card, and no number this time.
    const again = (await (await s.issue()).json()) as { last4: string; number?: string };
    expect(again.last4).toBe(card.last4);
    expect(again.number).toBeUndefined();
  });

  it("not for an escrow that isn't this agent's, or isn't held", async () => {
    const other = await setup({
      state: "held",
      payee: privateKeyToAccount(generatePrivateKey()).address,
      amount: 50_000n,
    });
    expect((await other.issue()).status).toBe(409);
    const refunded = await setup({ state: "refunded", payee: agent.address, amount: 50_000n });
    expect((await refunded.issue()).status).toBe(409);
  });

  it("follows the escrow: captured when it pays out, voided when the agent or a refund ends it", async () => {
    const s = await setup({ state: "held", payee: agent.address, amount: 32_347n });
    await s.issue();
    await s.issuer.capture(ESCROW);
    expect((await s.hire())?.card?.status).toBe("captured");
    await s.issuer.voidFor(ESCROW); // a captured card isn't voided
    expect((await s.hire())?.card?.status).toBe("captured");

    const t = await setup({ state: "held", payee: agent.address, amount: 32_347n });
    await t.issue();
    const res = await t.issuer.routes.request("/cards/void", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        escrowId: ESCROW,
        agent: agent.address,
        signature: await agent.signMessage({ message: voidCardMessage(ESCROW) }),
      }),
    });
    expect(res.status).toBe(200);
    expect((await t.hire())?.card?.status).toBe("voided");
  });
});
