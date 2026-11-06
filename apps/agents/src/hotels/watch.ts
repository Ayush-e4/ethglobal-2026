import type { LiteApiClient } from "@app/travel";
import type { JsonStore } from "../store";
import type { Job, Rebook, StoredQuote, Watch } from "./types";

/** A rebook must be worth it: at least ₹200, and at least 2% of the stay. */
export const worthRebooking = (paid: number, now: number) =>
  paid - now >= Math.max(200, paid * 0.02);

/**
 * A watching agent's promise, kept: after a booking is delivered, re-check the same room's live
 * price until check-in. If it's cheaper by enough, book the cheaper rate first (the guest is
 * never without a room), then cancel the old one (refundable: refunded in full); the difference
 * goes back to the guest. If the old one won't cancel, the new one is cancelled instead, so the
 * guest never holds two. Every check and rebook is on the job, for the buyer to read.
 */
export class PriceWatcher {
  private running = false;

  constructor(
    private readonly d: {
      lite: LiteApiClient;
      jobs: JsonStore<Job>;
      quotes: JsonStore<StoredQuote>;
      everyMs: number;
      now?: () => number;
    },
  ) {}

  start() {
    const timer = setInterval(() => void this.tick(), this.d.everyMs);
    return () => clearInterval(timer);
  }

  private now = () => (this.d.now ?? Date.now)();

  private setWatch(job: Job, changes: Partial<Watch>): Job {
    const next = { ...job, watch: { ...(job.watch as Watch), ...changes } };
    this.d.jobs.set(job.escrowId, next);
    return next;
  }

  /** Demo only: the next check sees the price `inr` lower than LiteAPI says, labelled so. */
  simulateDrop(escrowId: string, inr: number): Job | null {
    const job = this.d.jobs.get(escrowId);
    if (!job?.watch?.active) return null;
    return this.setWatch(job, { demoDrop: inr });
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      for (const [, job] of this.d.jobs.all())
        if (job.status === "delivered" && job.watch?.active)
          await this.check(job.escrowId).catch((e) =>
            console.error(`watch ${job.escrowId}: ${e instanceof Error ? e.message : e}`),
          );
    } finally {
      this.running = false;
    }
  }

  /** One check of one booked room; rebooks it if it's now cheaper enough. */
  async check(escrowId: string): Promise<Rebook | null> {
    let job = this.d.jobs.get(escrowId);
    const w = job?.watch;
    if (!job || !w?.active || !job.bookingId) return null;
    if (new Date(`${w.checkin}T00:00:00+05:30`).getTime() <= this.now()) {
      this.setWatch(job, { active: false, note: "Check-in day: the watch is over" });
      return null;
    }
    const offers = await this.d.lite.searchHotels({
      hotelIds: [w.hotelId],
      checkin: w.checkin,
      checkout: w.checkout,
      adults: w.adults,
      refundableOnly: true,
      limit: 5,
    });
    const same = offers.find((o) => o.roomName === w.roomName && o.currency === w.currency);
    job = this.setWatch(job, {
      checks: w.checks + 1,
      lastCheckAt: this.now(),
      demoDrop: undefined,
    });
    if (!same) return null;
    const simulated = (w.demoDrop ?? 0) > 0;
    const now = same.total - (w.demoDrop ?? 0);
    if (!worthRebooking(w.paid, now)) return null;

    const pre = await this.d.lite.prebook(same.offerId);
    const booked = await this.d.lite.book(pre.prebookId, job.guest, `${escrowId.slice(0, 14)}-r`);
    try {
      await this.d.lite.cancel(job.bookingId as string);
    } catch (e) {
      await this.d.lite.cancel(booked.bookingId).catch(() => {});
      throw new Error(
        `old booking wouldn't cancel; kept it: ${e instanceof Error ? e.message : e}`,
      );
    }
    const rebook: Rebook = {
      at: this.now(),
      fromBookingId: job.bookingId as string,
      toBookingId: booked.bookingId,
      from: w.paid,
      to: now,
      saved: w.paid - now,
      currency: w.currency,
      simulated,
    };
    this.d.jobs.set(escrowId, {
      ...job,
      bookingId: booked.bookingId,
      confirmation: booked.confirmationCode,
      watch: { ...(job.watch as Watch), paid: now, rebooks: [...w.rebooks, rebook] },
    });
    return rebook;
  }
}
