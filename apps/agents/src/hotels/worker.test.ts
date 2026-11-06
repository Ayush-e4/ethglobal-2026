import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cancelBookingMessage } from "@app/shared";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { JsonStore } from "../store";
import type { Job, StoredQuote } from "./types";
import { hotelWorker } from "./worker";

const ESCROW = `0x${"ab".repeat(32)}` as Hex;
const QUOTE = `0x${"cd".repeat(32)}` as Hex;
const agent = privateKeyToAccount(generatePrivateKey());
const buyerAi = privateKeyToAccount(generatePrivateKey()); // the concierge's key on the limit
const buyerWallet = privateKeyToAccount(generatePrivateKey());

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
    getMandate: vi.fn(async () => ({ owner: buyerWallet.address, agent: buyerAi.address })),
  };
  const lite = { book: vi.fn(book), cancel: vi.fn(async () => ({})) };
  const arkiv = { address: agent.address, run: vi.fn(async () => ({ txHash: "0x1" })) };
  const worker = hotelWorker({ registry, agent, lite, arkiv, jobs, quotes } as never);
  return { worker, jobs, quotes, registry, lite };
}

describe("paying the hotel with a one-time card", () => {
  it("gets a card locked to the hotel and the escrowed price before booking; a failed booking voids it", async () => {
    const cardCalls: unknown[] = [];
    const cards = {
      issue: vi.fn(async (r: unknown) => {
        cardCalls.push(r);
        return {
          id: "c1",
          last4: "4821",
          brand: "Visa (simulated)",
          merchant: "Park Inn",
          amount: 12347,
          currency: "INR",
          expiresAt: 0,
          status: "authorized" as const,
        };
      }),
      void: vi.fn(async () => {}),
    };
    const make = (book: () => Promise<unknown>) => {
      const t = setup("held", book);
      t.quotes.set(QUOTE, {
        key: QUOTE,
        prebookId: "pre1",
        hotelName: "Park Inn",
        total: 12347,
        currency: "INR",
        priceUnits: "12347",
      } as StoredQuote);
      const worker = hotelWorker({
        registry: t.registry,
        agent,
        lite: t.lite,
        arkiv: { address: agent.address, run: vi.fn(async () => ({ txHash: "0x1" })) },
        jobs: t.jobs,
        quotes: t.quotes,
        cards,
      } as never);
      return { ...t, worker };
    };
    const ok = make(async () => ({ bookingId: "B1" }));
    await ok.worker.process(ESCROW);
    expect(cardCalls[0]).toEqual({
      escrowId: ESCROW,
      merchant: "Park Inn",
      amount: 12347,
      currency: "INR",
      amountUnits: "12347",
    });
    expect(ok.jobs.get(ESCROW)).toMatchObject({
      status: "delivered",
      card: { last4: "4821", status: "authorized" },
    });

    const failed = make(async () => {
      throw new Error("sold out");
    });
    await failed.worker.process(ESCROW);
    expect(cards.void).toHaveBeenCalledWith(ESCROW);
    expect(failed.jobs.get(ESCROW)).toMatchObject({
      status: "refunded",
      card: { status: "voided" },
    });
  });
});

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

  it("a reported booking: only if Hedera says it's disputed; then cancelled and refunded", async () => {
    const t = setup("delivered", async () => ({}));
    t.jobs.set(ESCROW, { ...(t.jobs.get(ESCROW) as Job), status: "delivered", bookingId: "B1" });
    expect(await t.worker.onDispute(ESCROW, "not_found")).toEqual({ outcome: "not_disputed" });
    expect(t.lite.cancel).not.toHaveBeenCalled(); // nobody else can get a guest's booking cancelled
    t.registry.getEscrow.mockResolvedValue({ state: "disputed" });
    expect(await t.worker.onDispute(ESCROW, "not_found")).toEqual({
      outcome: "refunded",
      cancelled: true,
    });
    expect(t.lite.cancel).toHaveBeenCalledWith("B1");
    expect(t.registry.refund).toHaveBeenCalled();
    expect(t.jobs.get(ESCROW)).toMatchObject({
      status: "refunded",
      note: expect.stringMatching(/buyer's report \(not_found\); the booking is cancelled/),
    });
    // Asked again: already done, nothing twice.
    expect(await t.worker.onDispute(ESCROW, "not_found")).toEqual({
      outcome: "refunded",
      cancelled: true,
    });
    expect(t.registry.refund).toHaveBeenCalledTimes(1);
  });

  it("cancelling a booked stay: only with the buyer's signature; the fee stays paid", async () => {
    const t = setup("released", async () => ({}));
    t.jobs.set(ESCROW, { ...(t.jobs.get(ESCROW) as Job), status: "delivered", bookingId: "B1" });
    const stranger = privateKeyToAccount(generatePrivateKey());
    const sign = (who: typeof stranger) =>
      who.signMessage({ message: cancelBookingMessage(ESCROW) });
    expect(await t.worker.cancelBooking(ESCROW, await sign(stranger))).toEqual({
      outcome: "not_the_buyer",
    });
    expect(t.lite.cancel).not.toHaveBeenCalled();
    expect(await t.worker.cancelBooking(ESCROW, await sign(buyerAi))).toEqual({
      outcome: "cancelled",
    });
    expect(t.lite.cancel).toHaveBeenCalledWith("B1");
    expect(t.registry.refund).not.toHaveBeenCalled();
    expect(t.jobs.get(ESCROW)).toMatchObject({ bookingCancelled: true, status: "delivered" });
  });
});
