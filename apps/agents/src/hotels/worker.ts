import { recordDelivery, type SafeArkivWriter } from "@app/arkiv";
import type { MandateClient } from "@app/mandates";
import type { LiteApiClient } from "@app/travel";
import { type Hex, keccak256, type LocalAccount, toHex } from "viem";
import type { JsonStore } from "../store";
import type { Job, StoredQuote } from "./types";

/**
 * Does the paid jobs: waits out each undo window, checks the money is still held (the buyer may
 * have cancelled), books the room, then marks it delivered on-chain (the registry schedules the
 * payout) and on Arkiv. If the booking fails, it refunds. Jobs live in a file, so a restart picks
 * them up again; a booking whose outcome is unknown is flagged, never booked twice.
 */
export class HotelWorker {
  constructor(
    private readonly d: {
      registry: MandateClient;
      agent: LocalAccount;
      lite: LiteApiClient;
      arkiv: SafeArkivWriter;
      jobs: JsonStore<Job>;
      quotes: JsonStore<StoredQuote>;
      watches?: boolean; // keeps watching the room's price after delivery (PriceGuard)
    },
  ) {}

  schedule(job: Job): void {
    const wait = Math.max(0, job.startsAt * 1000 - Date.now()) + 4000; // Hedera's clock can lag 2 s
    setTimeout(
      () =>
        void this.process(job.escrowId).catch((e) => console.error(`job ${job.escrowId}: ${e}`)),
      wait,
    );
  }

  /** After a restart: carry on with held jobs; flag bookings that were cut off mid-way. */
  resume(): void {
    for (const [, job] of this.d.jobs.all()) {
      if (job.status === "held") this.schedule(job);
      if (job.status === "booking" && !job.bookingId) {
        this.save(job, {
          status: "failed",
          note: "restarted mid-booking: check LiteAPI before acting",
        });
      } else if (job.status === "booking") this.schedule(job);
    }
  }

  private save(job: Job, changes: Partial<Job>): Job {
    const next = { ...job, ...changes };
    this.d.jobs.set(job.escrowId, next);
    return next;
  }

  async process(escrowId: Hex): Promise<void> {
    let job = this.d.jobs.get(escrowId);
    if (!job || !["held", "booking"].includes(job.status)) return;
    const escrow = await this.d.registry.getEscrow(escrowId);
    if (escrow.state === "refunded") {
      this.save(job, { status: "cancelled", note: "undone by the buyer: nothing booked" });
      return;
    }
    if (escrow.state !== "held") return;
    const quote = this.d.quotes.get(job.quoteKey);
    if (!quote) return void (await this.refund(job, "quote not found"));

    if (!job.bookingId) {
      job = this.save(job, { status: "booking" });
      try {
        const b = await this.d.lite.book(quote.prebookId, job.guest, escrowId.slice(0, 18));
        job = this.save(job, { bookingId: b.bookingId, confirmation: b.confirmationCode });
      } catch (e) {
        return void (await this.refund(
          job,
          `booking failed: ${e instanceof Error ? e.message : e}`,
        ));
      }
    }
    const bookingId = job.bookingId as string;
    const r = await this.d.registry.markDelivered(
      this.d.agent,
      escrowId,
      keccak256(toHex(bookingId)),
    );
    job = this.save(job, {
      status: "delivered",
      deliveredTx: r.transactionHash,
      // A watching agent's work goes on: re-check this room's price until check-in.
      ...(this.d.watches && quote.hotelId
        ? {
            watch: {
              active: true,
              hotelId: quote.hotelId,
              roomName: quote.roomName,
              checkin: quote.checkin,
              checkout: quote.checkout,
              adults: quote.adults,
              paid: quote.total,
              currency: quote.currency,
              checks: 0,
              rebooks: [],
            },
          }
        : {}),
    });
    await recordDelivery(this.d.arkiv, {
      task: job.task,
      agent: this.d.arkiv.address,
      quote: job.quoteKey,
      status: "delivered",
      resultHash: keccak256(toHex(bookingId)),
    }).catch((e) => console.error(`arkiv delivery for ${escrowId}: ${e}`));
  }

  private async refund(job: Job, note: string): Promise<void> {
    const r = await this.d.registry.refund(this.d.agent, job.escrowId);
    this.save(job, { status: "refunded", refundTx: r.transactionHash, note });
    await recordDelivery(this.d.arkiv, {
      task: job.task,
      agent: this.d.arkiv.address,
      quote: job.quoteKey,
      status: "refunded",
    }).catch((e) => console.error(`arkiv refund record for ${job.escrowId}: ${e}`));
  }
}
