import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chats, hires, users } from "../db/schema";
import { testDb } from "../test/db";
import { hireFollower } from "./follow";

afterEach(() => vi.unstubAllGlobals());

async function setup(
  status: "held" | "paying" | "delivered" | "disputed",
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
  const booked: string[] = [];
  const follower = hireFollower(
    db,
    {
      getEscrow: async () => ({ state: escrowState, deliveredAt: 1000n, reviewSeconds: 900 }),
    } as never,
    {
      add: async (_c: string, _r: string, text: string) => {
        posted.push(text);
        return {} as never;
      },
    },
    5000,
    {
      onBooked: async (_h, ref) => booked.push(ref),
      onDisputeSettled: async () => booked.push("settled"),
      onRefunded: async (_h, why) => booked.push(`email:${why}`),
    },
  );
  const read = async () =>
    (
      await db
        .select()
        .from(hires)
        .where(eq(hires.id, hire?.id as string))
    )[0];
  return { follower, posted, read, booked };
}

describe("hireFollower", () => {
  it("posts the booking reference when the agent delivers", async () => {
    const t = await setup("held", "delivered", { status: "delivered", bookingId: "uw4P2UqWj" });
    await t.follower.tick();
    expect((await t.read())?.status).toBe("delivered");
    expect(t.posted[0]).toContain("uw4P2UqWj");
    expect(t.booked).toEqual(["uw4P2UqWj"]); // the confirmation email, once
    await t.follower.tick();
    expect(t.booked).toHaveLength(1);
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

  it("a reported booking the agent refunded: said in the chat, and settled on the record", async () => {
    const t = await setup("disputed", "refunded", {
      note: "Refunded after the buyer's report (not_found); the hotel booking is cancelled",
    });
    await t.follower.tick();
    expect((await t.read())?.status).toBe("refunded");
    expect(t.posted[0]).toBe(
      "StayWise accepted your report on Park Inn: the 0.02 USDC fee is refunded, and the booking is cancelled.",
    );
    expect(t.booked).toEqual(["settled", "email:report"]);
  });

  it("records when the review window ends, once delivered", async () => {
    const t = await setup("held", "delivered", { status: "delivered", bookingId: "B1" });
    await t.follower.tick();
    expect((await t.read())?.reviewUntil?.getTime()).toBe((1000 + 900) * 1000);
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
