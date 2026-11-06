import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chats, hires, users } from "../db/schema";
import { testDb } from "../test/db";
import { hireFollower } from "./follow";

afterEach(() => vi.unstubAllGlobals());

async function setup(
  status: "held" | "paying" | "delivered",
  escrowState: string,
  job: unknown,
  note: string | null = null,
) {
  const db = await testDb();
  const [u] = await db.insert(users).values({ isDemo: true }).returning();
  const [chat] = await db
    .insert(chats)
    .values({ userId: u?.id as string, title: "t" })
    .returning();
  const [hire] = await db
    .insert(hires)
    .values({
      chatId: chat?.id as string,
      userId: u?.id as string,
      quoteKey: "k",
      agentName: "StayWise",
      title: "Park Inn",
      feeUnits: BigInt(20000),
      status,
      escrowId: `0x${"ab".repeat(32)}`,
      jobUrl: "http://agent/jobs/1",
      note,
      updatedAt: new Date(Date.now() - 10 * 60_000),
    })
    .returning();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(job)),
  );
  const posted: string[] = [];
  const follower = hireFollower(db, { getEscrow: async () => ({ state: escrowState }) } as never, {
    add: async (_c: string, _r: string, text: string) => {
      posted.push(text);
      return {} as never;
    },
  });
  const read = async () =>
    (
      await db
        .select()
        .from(hires)
        .where(eq(hires.id, hire?.id as string))
    )[0];
  return { follower, posted, read };
}

describe("hireFollower", () => {
  it("posts the booking reference when the agent delivers", async () => {
    const t = await setup("held", "delivered", { status: "delivered", bookingId: "uw4P2UqWj" });
    await t.follower.tick();
    expect((await t.read())?.status).toBe("delivered");
    expect(t.posted[0]).toContain("uw4P2UqWj");
  });

  it("marks it released once Hedera paid the agent", async () => {
    const t = await setup("delivered", "released", {});
    await t.follower.tick();
    expect((await t.read())?.status).toBe("released");
  });

  it("tells the user when the agent refunded", async () => {
    const t = await setup("held", "refunded", {});
    await t.follower.tick();
    expect((await t.read())?.status).toBe("refunded");
    expect(t.posted[0]).toMatch(/refunded/);
  });

  it("an undo in progress isn't taken for the agent refunding", async () => {
    const t = await setup("held", "refunded", {}, "undoing"); // Hedera refunded, the save is next
    await t.follower.tick();
    expect((await t.read())?.status).toBe("cancelled");
    expect(t.posted).toEqual([]);
  });

  it("after a restart, a hire stuck mid-payment is flagged, never paid again", async () => {
    const t = await setup("paying", "none", {});
    const stop = await t.follower.start();
    stop();
    expect(await t.read()).toMatchObject({ status: "failed" });
    expect((await t.read())?.note).toMatch(/restart/);
  });

  it("a watching agent: followed after delivery, and each rebook told in the chat once", async () => {
    const rebook = {
      from: 10000,
      to: 9200,
      saved: 800,
      currency: "INR",
      toBookingId: "B-new",
      simulated: true,
    };
    const watching = { active: true, checkin: "2026-12-20", rebooks: [] as unknown[] };
    const t = await setup("held", "held", {
      status: "delivered",
      bookingId: "B-old",
      watch: watching,
    });
    await t.follower.tick();
    expect(await t.read()).toMatchObject({
      watching: true,
      watchNote: "watching the price until 20 Dec",
    });

    watching.rebooks.push(rebook); // the agent rebooked it cheaper
    await t.follower.tick();
    await t.follower.tick(); // told once, not on every tick
    const rebooks = t.posted.filter((p) => p.includes("rebooked"));
    expect(rebooks).toHaveLength(1);
    expect(rebooks[0]).toMatch(
      /₹10,000 → ₹9,200, so ₹800 comes back to you\. New booking reference B-new\. \(A simulated/,
    );
    expect(await t.read()).toMatchObject({
      bookingRef: "B-new",
      rebooksSeen: 1,
      watchNote: "Saved ₹800 · 1 rebook · watching the price until 20 Dec",
    });
  });
});
