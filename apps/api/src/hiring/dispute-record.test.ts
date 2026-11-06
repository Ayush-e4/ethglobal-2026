import { describe, expect, it, vi } from "vitest";
import { chats, hires, quotes, users, worldChecks } from "../db/schema";
import { testDb } from "../test/db";
import { arkivDisputes } from "./dispute-record";

const AGENT = "0x00000000000000000000000000000000000000a1";

async function setup(isDemo: boolean, verified: boolean) {
  const db = await testDb();
  const [u] = await db.insert(users).values({ isDemo }).returning();
  if (!u) throw new Error("no user");
  if (verified)
    await db.insert(worldChecks).values({
      userId: u.id,
      purpose: "bonus",
      userCode: "A",
      link: "https://w",
      deviceCode: "d",
      intervalS: 5,
      startedAtS: 0,
      expiresAt: new Date(),
      status: "verified",
    });
  const [c] = await db.insert(chats).values({ userId: u.id, title: "t" }).returning();
  await db.insert(quotes).values({
    key: "k",
    chatId: c?.id as string,
    agentName: "StayWise",
    agentAddress: AGENT,
    endpoint: "http://a",
    feeUnits: 20_000n,
    summary: "s",
    expiresAt: new Date(Date.now() + 60_000),
  });
  const [h] = await db
    .insert(hires)
    .values({
      chatId: c?.id as string,
      userId: u.id,
      quoteKey: "k",
      agentName: "StayWise",
      title: "t",
      feeUnits: 20_000n,
      escrowId: `0x${"cd".repeat(32)}`,
      status: "delivered",
    })
    .returning();
  const run = vi.fn(async () => ({ txHash: "0x1", createdEntities: [] }));
  return {
    disputes: arkivDisputes(db, { run, client: { createEntity: vi.fn() } } as never),
    hire: h,
    run,
  };
}

describe("reports on the public record", () => {
  it("a demo or unverified account's report doesn't count against the agent", async () => {
    for (const [isDemo, verified] of [
      [true, true],
      [false, false],
    ] as const) {
      const { disputes, hire, run } = await setup(isDemo, verified);
      await disputes.onDispute(hire as never, "not_found", "open");
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("a World ID-verified person's report does", async () => {
    const { disputes, hire, run } = await setup(false, true);
    await disputes.onDispute(hire as never, "not_found", "open");
    expect(run).toHaveBeenCalledTimes(1);
  });
});
