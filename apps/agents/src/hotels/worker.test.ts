import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { JsonStore } from "../store";
import type { Job, StoredQuote } from "./types";
import { HotelWorker } from "./worker";

const ESCROW = `0x${"ab".repeat(32)}` as Hex;
const QUOTE = `0x${"cd".repeat(32)}` as Hex;
const agent = privateKeyToAccount(generatePrivateKey());

function setup(state: string, book: () => Promise<unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "sw-"));
  const jobs = new JsonStore<Job>(join(dir, "jobs.json"));
  const quotes = new JsonStore<StoredQuote>(join(dir, "quotes.json"));
  quotes.set(QUOTE, { key: QUOTE, prebookId: "pre1" } as StoredQuote);
  const job: Job = {
    escrowId: ESCROW,
    quoteKey: QUOTE,
    task: "goa",
    guest: {
      firstName: "Test",
      lastName: "Traveller",
      email: "t@example.com",
      phone: "+910000000",
    },
    status: "held",
    startsAt: 0,
  };
  jobs.set(ESCROW, job);
  const registry = {
    getEscrow: vi.fn(async () => ({ state })),
    markDelivered: vi.fn(async () => ({ transactionHash: "0xdelivered" })),
    refund: vi.fn(async () => ({ transactionHash: "0xrefund" })),
  };
  const lite = { book: vi.fn(book) };
  const arkiv = { address: agent.address, run: vi.fn(async () => ({ txHash: "0x1" })) };
  const worker = new HotelWorker({ registry, agent, lite, arkiv, jobs, quotes } as never);
  return { worker, jobs, registry, lite };
}

describe("HotelWorker", () => {
  it("books after the window, then marks it delivered", async () => {
    const t = setup("held", async () => ({ bookingId: "B1", status: "CONFIRMED" }));
    await t.worker.process(ESCROW);
    expect(t.lite.book).toHaveBeenCalledWith("pre1", expect.anything(), ESCROW.slice(0, 18));
    expect(t.registry.markDelivered).toHaveBeenCalled();
    expect(t.jobs.get(ESCROW)).toMatchObject({ status: "delivered", bookingId: "B1" });
  });

  it("does nothing if the buyer undid it", async () => {
    const t = setup("refunded", async () => ({ bookingId: "B1" }));
    await t.worker.process(ESCROW);
    expect(t.lite.book).not.toHaveBeenCalled();
    expect(t.jobs.get(ESCROW)?.status).toBe("cancelled");
  });

  it("refunds when the booking fails", async () => {
    const t = setup("held", async () => {
      throw new Error("LiteAPI /v3.0/rates/book: HTTP 500");
    });
    await t.worker.process(ESCROW);
    expect(t.registry.refund).toHaveBeenCalled();
    expect(t.registry.markDelivered).not.toHaveBeenCalled();
    expect(t.jobs.get(ESCROW)?.status).toBe("refunded");
  });

  it("never books twice: a restart mid-booking is flagged, not retried", () => {
    const t = setup("held", async () => ({ bookingId: "B2" }));
    t.jobs.set(ESCROW, { ...(t.jobs.get(ESCROW) as Job), status: "booking" });
    t.worker.resume();
    expect(t.jobs.get(ESCROW)?.status).toBe("failed");
    expect(t.lite.book).not.toHaveBeenCalled();
  });

  it("a booked job whose delivery mark failed is finished without booking again", async () => {
    const t = setup("held", async () => ({ bookingId: "B3" }));
    t.jobs.set(ESCROW, { ...(t.jobs.get(ESCROW) as Job), status: "booking", bookingId: "B1" });
    await t.worker.process(ESCROW);
    expect(t.lite.book).not.toHaveBeenCalled();
    expect(t.jobs.get(ESCROW)).toMatchObject({ status: "delivered", bookingId: "B1" });
  });
});
