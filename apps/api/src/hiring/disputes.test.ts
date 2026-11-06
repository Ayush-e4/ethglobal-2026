import { eq } from "drizzle-orm";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../db/client";
import { chats, hires, users } from "../db/schema";
import { testDb } from "../test/db";
import { disputeHire, reportedNote } from "./disputes";

const concierge = privateKeyToAccount(`0x${"11".repeat(32)}`);
afterEach(() => vi.unstubAllGlobals());

async function setup(o: { status?: "delivered" | "held"; reviewInMs?: number } = {}) {
  const db: Db = await testDb();
  const [user] = await db.insert(users).values({}).returning();
  if (!user) throw new Error("no user");
  const [chat] = await db.insert(chats).values({ userId: user.id, title: "Goa" }).returning();
  const [hire] = await db
    .insert(hires)
    .values({
      chatId: chat?.id ?? "",
      userId: user.id,
      quoteKey: "k",
      agentName: "StayWise",
      title: "Park Inn · 10–12 Jan",
      feeUnits: 20_000n,
      status: o.status ?? "delivered",
      escrowId: `0x${"e5".repeat(32)}`,
      jobUrl: "http://agent/jobs/0xe5",
      reviewUntil: new Date(Date.now() + (o.reviewInMs ?? 600_000)),
    })
    .returning();
  if (!hire) throw new Error("no hire");
  const registry = { dispute: vi.fn(async () => ({})) };
  const told: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      told.push({ url, body: JSON.parse(init.body) });
      return Response.json({ outcome: "refunded" });
    }),
  );
  const filed: unknown[] = [];
  const d = {
    db,
    registry: registry as never,
    concierge,
    onDispute: async (h: { status: string }, reason: string, outcome: string) =>
      void filed.push({ status: h.status, reason, outcome }),
  };
  return { db, d, user, chat, hire, registry, told, filed };
}

describe("reporting a problem", () => {
  it("within the review: the fee freezes on Hedera, it goes on the record, and the agent is told", async () => {
    const { db, d, user, hire, registry, told, filed } = await setup();
    const h = await disputeHire(d, user, hire.chatId, hire.id, "not_found");
    expect(registry.dispute).toHaveBeenCalledWith(concierge, hire.escrowId);
    expect(h).toMatchObject({
      status: "disputed",
      note: "reported: The hotel can't find my booking",
    });
    expect((await db.select().from(hires).where(eq(hires.id, hire.id)))[0]?.status).toBe(
      "disputed",
    );
    expect(filed).toEqual([{ status: "disputed", reason: "not_found", outcome: "open" }]);
    expect(told).toEqual([
      { url: "http://agent/jobs/0xe5/dispute", body: { reason: "not_found" } },
    ]);
    expect(reportedNote(h, "not_found")).toMatch(
      /^Reported to StayWise: "The hotel can't find my booking"\. The 0\.02 USDC fee is frozen/,
    );
    // Reported twice: nothing more happens.
    await disputeHire(d, user, hire.chatId, hire.id, "not_found");
    expect(registry.dispute).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["after the review window", { reviewInMs: -1000 }],
    ["before it's delivered", { status: "held" as const }],
  ])("not %s", async (_, o) => {
    const { d, user, hire, registry } = await setup(o);
    await expect(disputeHire(d, user, hire.chatId, hire.id, "other")).rejects.toThrow(/Too late/);
    expect(registry.dispute).not.toHaveBeenCalled();
  });

  it("only your own hire", async () => {
    const { db, d, hire, registry } = await setup();
    const [someone] = await db.insert(users).values({}).returning();
    if (!someone) throw new Error("no user");
    await expect(disputeHire(d, someone, hire.chatId, hire.id, "other")).rejects.toThrow(
      /No such hire/,
    );
    expect(registry.dispute).not.toHaveBeenCalled();
  });
});
