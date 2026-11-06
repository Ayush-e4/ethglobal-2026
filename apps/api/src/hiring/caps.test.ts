import { describe, expect, it } from "vitest";
import { chats, hires, lookups, users } from "../db/schema";
import { testDb } from "../test/db";
import { demoCapsAllow } from "./caps";

const caps = { perUser: BigInt(60_000), total: BigInt(100_000) };

async function setup() {
  const db = await testDb();
  const [a] = await db.insert(users).values({ isDemo: true }).returning();
  const [b] = await db.insert(users).values({ isDemo: true }).returning();
  const [chat] = await db
    .insert(chats)
    .values({ userId: a?.id as string, title: "t" })
    .returning();
  const hire = (
    userId: string,
    fee: number,
    status: "held" | "cancelled" = "held",
    price?: number,
  ) =>
    db.insert(hires).values({
      priceUnits: price === undefined ? null : BigInt(price),
      chatId: chat?.id as string,
      userId,
      quoteKey: "k",
      agentName: "StayWise",
      title: "t",
      feeUnits: BigInt(fee),
      demo: true,
      status,
    });
  const lookup = (userId: string, fee: number) =>
    db.insert(lookups).values({
      userId,
      chatId: chat?.id as string,
      agentName: "Bank Check",
      agentAddress: "0x00000000000000000000000000000000000000b1",
      skill: "bank-check",
      feeUnits: BigInt(fee),
      input: {},
      status: "answered",
    });
  return { db, a: a?.id as string, b: b?.id as string, hire, lookup };
}

describe("demo caps", () => {
  it("allow spending up to the per-account cap", async () => {
    const { db, a, hire } = await setup();
    await hire(a, 40_000);
    expect(await demoCapsAllow(db, a, BigInt(20_000), caps)).toBeNull();
    expect(await demoCapsAllow(db, a, BigInt(20_001), caps)).toMatch(/daily spending/);
  });

  it("undone fees don't count", async () => {
    const { db, a, hire } = await setup();
    await hire(a, 50_000, "cancelled");
    expect(await demoCapsAllow(db, a, BigInt(50_000), caps)).toBeNull();
  });

  it("the shared wallet has a total cap across accounts", async () => {
    const { db, a, b, hire } = await setup();
    await hire(a, 50_000);
    await hire(b, 40_000);
    expect(await demoCapsAllow(db, b, BigInt(20_000), caps)).toMatch(/demo's daily budget/);
  });

  it("everything the demo wallet pays counts: the trip price with the fee, and lookups", async () => {
    const { db, a, hire, lookup } = await setup();
    await hire(a, 20_000, "held", 30_000); // a ₹30,000 stay with a 0.02 fee
    await lookup(a, 5_000);
    expect(await demoCapsAllow(db, a, BigInt(5_000), caps)).toBeNull(); // 55,000 + 5,000 = 60,000
    expect(await demoCapsAllow(db, a, BigInt(5_001), caps)).toMatch(/daily spending/);
  });
});
