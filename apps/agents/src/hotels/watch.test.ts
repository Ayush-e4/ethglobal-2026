import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { JsonStore } from "../store";
import type { Job, StoredQuote } from "./types";
import { PriceWatcher, worthRebooking } from "./watch";

const ESCROW = `0x${"e1".repeat(32)}` as const;

function setup(livePrice: number, opts: { oldWontCancel?: boolean; checkin?: string } = {}) {
  const calls: string[] = [];
  const lite = {
    searchHotels: vi.fn(async () => [
      {
        offerId: "o-new",
        hotelId: "h1",
        hotelName: "Park Inn",
        roomName: "Deluxe",
        total: livePrice,
        currency: "INR",
      },
    ]),
    prebook: vi.fn(async () => {
      calls.push("prebook");
      return { prebookId: "p-new", total: livePrice, currency: "INR", refundable: true };
    }),
    book: vi.fn(async () => {
      calls.push("book new");
      return { bookingId: "B-new", status: "CONFIRMED", confirmationCode: "C2" };
    }),
    cancel: vi.fn(async (id: string) => {
      calls.push(`cancel ${id}`);
      if (id === "B-old" && opts.oldWontCancel) throw new Error("LiteAPI /bookings: HTTP 400");
      return { status: "CANCELLED", fee: 0, refund: 10000, currency: "INR" };
    }),
  };
  const jobs = new JsonStore<Job>(join(mkdtempSync(join(tmpdir(), "w-")), "jobs.json"));
  const quotes = new JsonStore<StoredQuote>(join(mkdtempSync(join(tmpdir(), "w-")), "q.json"));
  jobs.set(ESCROW, {
    escrowId: ESCROW,
    quoteKey: `0x${"ab".repeat(32)}`,
    task: "t1",
    guest: {
      firstName: "Test",
      lastName: "Traveller",
      email: "t@example.com",
      phone: "+919800000000",
    },
    status: "delivered",
    startsAt: 0,
    bookingId: "B-old",
    watch: {
      active: true,
      hotelId: "h1",
      roomName: "Deluxe",
      checkin: opts.checkin ?? "2026-12-20",
      checkout: "2026-12-22",
      adults: 2,
      paid: 10000,
      currency: "INR",
      checks: 0,
      rebooks: [],
    },
  });
  const watcher = new PriceWatcher({
    lite: lite as never,
    jobs,
    quotes,
    everyMs: 60_000,
    now: () => Date.parse("2026-11-06T08:00:00Z"),
  });
  return { watcher, jobs, calls };
}

describe("PriceWatcher", () => {
  it("rebooks the same room when it's cheaper enough: the new one first, then the old cancelled", async () => {
    const { watcher, jobs, calls } = setup(9000);
    const r = await watcher.check(ESCROW);
    expect(r).toMatchObject({
      from: 10000,
      to: 9000,
      saved: 1000,
      simulated: false,
      toBookingId: "B-new",
    });
    expect(calls).toEqual(["prebook", "book new", "cancel B-old"]);
    const job = jobs.get(ESCROW);
    expect(job?.bookingId).toBe("B-new");
    expect(job?.watch).toMatchObject({ paid: 9000, checks: 1 });
  });

  it("leaves it when the drop isn't worth it", async () => {
    const { watcher, calls } = setup(9900); // ₹100 less: under ₹200 and 2%
    expect(await watcher.check(ESCROW)).toBeNull();
    expect(calls).toEqual([]);
    expect(worthRebooking(10000, 9800)).toBe(true);
    expect(worthRebooking(50000, 49500)).toBe(false); // ₹500 is under 2% of ₹50,000
  });

  it("never leaves the guest holding two: if the old won't cancel, the new one is cancelled", async () => {
    const { watcher, jobs, calls } = setup(9000, { oldWontCancel: true });
    await expect(watcher.check(ESCROW)).rejects.toThrow(/kept it/);
    expect(calls).toEqual(["prebook", "book new", "cancel B-old", "cancel B-new"]);
    expect(jobs.get(ESCROW)?.bookingId).toBe("B-old");
  });

  it("a demo drop is a real rebook, labelled simulated, and used once", async () => {
    const { watcher, jobs } = setup(10000); // LiteAPI's price hasn't moved
    watcher.simulateDrop(ESCROW, 800);
    expect(await watcher.check(ESCROW)).toMatchObject({ saved: 800, simulated: true });
    expect(jobs.get(ESCROW)?.watch?.demoDrop).toBeUndefined();
    expect(await watcher.check(ESCROW)).toBeNull(); // the real price is above what's paid now
  });

  it("the watch ends on check-in day", async () => {
    const { watcher, jobs } = setup(5000, { checkin: "2026-11-06" });
    expect(await watcher.check(ESCROW)).toBeNull();
    expect(jobs.get(ESCROW)?.watch?.active).toBe(false);
  });
});
