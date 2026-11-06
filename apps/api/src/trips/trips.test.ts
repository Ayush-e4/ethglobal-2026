import { cancelBookingMessage } from "@app/shared";
import { recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSession } from "../auth/session";
import type { Db } from "../db/client";
import { chats, hires, users } from "../db/schema";
import { cancelBooking } from "../hiring/cancel-booking";
import type { HiringService } from "../hiring/service";
import { testDb } from "../test/db";
import { tripRoutes } from "./routes";

const concierge = privateKeyToAccount(`0x${"11".repeat(32)}`);
const ESCROW = `0x${"e5".repeat(32)}`;
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const db: Db = await testDb();
  const [user] = await db.insert(users).values({}).returning();
  if (!user) throw new Error("no user");
  const [chat] = await db.insert(chats).values({ userId: user.id, title: "Goa" }).returning();
  if (!chat) throw new Error("no chat");
  const [hire] = await db
    .insert(hires)
    .values({
      chatId: chat.id,
      userId: user.id,
      quoteKey: `0x${"ab".repeat(32)}`,
      agentName: "StayWise",
      title: "Park Inn · 10–12 Jan",
      feeUnits: 20_000n,
      status: "released",
      escrowId: ESCROW,
      jobUrl: "http://agent/jobs/0xe5",
      payTx: "0.0.1@1.2",
      bookingRef: "Tb8Y44VaX",
      guestName: "Asha Test",
      guestEmail: "asha.test@example.com",
    })
    .returning();
  if (!hire) throw new Error("no hire");
  const hiring = {
    registryAddress: `0x${"cc".repeat(20)}`,
    registry: {
      getEscrow: async () => ({
        state: "released",
        amount: 20_000n,
        deliveredAt: 0n,
        reviewSeconds: 900,
      }),
    },
  } as unknown as HiringService;
  const app = tripRoutes(db, hiring);
  const cookie = `app_session=${await createSession(db, user.id)}`;
  return { db, user, chat, hire, app, cookie };
}

describe("trips and receipts", () => {
  it("your trips: every booking, with its chat", async () => {
    const { app, cookie, hire } = await setup();
    const res = await app.request("/trips", { headers: { Cookie: cookie } });
    const [trip] = (await res.json()) as Record<string, unknown>[];
    expect(trip).toMatchObject({
      id: hire.id,
      chatTitle: "Goa",
      bookingRef: "Tb8Y44VaX",
      guestName: "Asha Test",
      canCancelBooking: true,
    });
    expect(JSON.stringify(trip)).not.toContain("asha.test@example.com");
    expect((await app.request("/trips")).status).toBe(401);
  });

  it("a receipt is public, but shows the guest as initials and the reference in part", async () => {
    const { app, hire } = await setup();
    const r = (await (await app.request(`/receipts/${hire.id}`)).json()) as Record<string, unknown>;
    expect(r).toMatchObject({
      title: "Park Inn · 10–12 Jan",
      guest: "A. T.",
      bookingRef: "Tb8…",
      escrow: { state: "released", amountUnits: "20000" },
    });
    const text = JSON.stringify(r);
    expect(text).not.toContain("Asha");
    expect(text).not.toContain("Tb8Y44VaX");
    expect(text).toContain("https://hashscan.io/testnet/transaction/0.0.1@1.2");
    expect((await app.request("/receipts/not-a-uuid")).status).toBe(404);
  });
});

describe("cancelling a booked stay", () => {
  it("asks the agent with a signature only the concierge can make, then marks it cancelled", async () => {
    const { db, user, chat, hire } = await setup();
    const sent: { url: string; signature: `0x${string}` }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        sent.push({ url, ...JSON.parse(init.body) });
        return Response.json({ outcome: "cancelled" });
      }),
    );
    const h = await cancelBooking({ db, concierge }, user, chat.id, hire.id);
    expect(h.bookingCancelledAt).toBeInstanceOf(Date);
    expect(sent[0]?.url).toBe("http://agent/jobs/0xe5/cancel-booking");
    const signer = await recoverMessageAddress({
      message: cancelBookingMessage(ESCROW),
      signature: sent[0]?.signature ?? "0x",
    });
    expect(signer).toBe(concierge.address);
    await expect(cancelBooking({ db, concierge }, user, chat.id, hire.id)).rejects.toThrow(
      /cancelled already/,
    );
  });

  it("says so when the agent couldn't, and leaves the booking as it was", async () => {
    const { db, user, chat, hire } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ outcome: "not_cancellable" })),
    );
    await expect(cancelBooking({ db, concierge }, user, chat.id, hire.id)).rejects.toThrow(
      /StayWise couldn't cancel it \(not_cancellable\)/,
    );
    const [someone] = await db.insert(users).values({}).returning();
    if (!someone) throw new Error("no user");
    await expect(cancelBooking({ db, concierge }, someone, chat.id, hire.id)).rejects.toThrow(
      /No such booking/,
    );
  });
});
