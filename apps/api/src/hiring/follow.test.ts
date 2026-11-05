import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chats, hires, users } from "../db/schema";
import { testDb } from "../test/db";
import { hireFollower } from "./follow";

afterEach(() => vi.unstubAllGlobals());

async function setup(status: "held" | "paying" | "delivered", escrowState: string, job: unknown) {
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

  it("after a restart, a hire stuck mid-payment is flagged, never paid again", async () => {
    const t = await setup("paying", "none", {});
    const stop = await t.follower.start();
    stop();
    expect(await t.read()).toMatchObject({ status: "failed" });
    expect((await t.read())?.note).toMatch(/restart/);
  });
});
