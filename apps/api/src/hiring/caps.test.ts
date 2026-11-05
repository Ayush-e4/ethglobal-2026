import { describe, expect, it } from "vitest";
import { chats, hires, users } from "../db/schema";
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
  const hire = (userId: string, fee: number, status: "held" | "cancelled" = "held") =>
    db.insert(hires).values({
      chatId: chat?.id as string,
      userId,
      quoteKey: "k",
      agentName: "StayWise",
      title: "t",
      feeUnits: BigInt(fee),
      demo: true,
      status,
    });
  return { db, a: a?.id as string, b: b?.id as string, hire };
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
});
