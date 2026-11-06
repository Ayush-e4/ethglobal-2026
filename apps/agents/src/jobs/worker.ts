import { recordDelivery, type SafeArkivWriter } from "@app/arkiv";
import type { MandateClient } from "@app/mandates";
import { cancelBookingMessage } from "@app/shared";
import { type Hex, keccak256, type LocalAccount, recoverMessageAddress, toHex } from "viem";
import type { JsonStore } from "../store";
import type { CardIssuer } from "./cards";
import type { PaidJob, QuoteBase, Supplier, WatchBase } from "./types";

/**
 * Does any agent's paid jobs: waits out each undo window, checks the money is still held (the
 * buyer may have cancelled), books it with the supplier (a hotel, an airline), then marks it
 * delivered on-chain (the registry schedules the payout) and on Arkiv. If the booking fails, it
 * refunds. Jobs live in a file, so a restart picks them up again; a booking whose outcome is
 * unknown is flagged, never booked twice.
 */
const RETRY_MS = 20_000; // then 40 s, 60 s…
const MAX_RETRIES = 8;

export class JobWorker<Q extends QuoteBase, W extends WatchBase = WatchBase> {
  constructor(
    private readonly d: {
      registry: MandateClient;
      agent: LocalAccount;
      supplier: Supplier<Q>;
      cards?: CardIssuer; // pays the hotel or airline with a one-time card, from the escrowed price
      arkiv: SafeArkivWriter;
      jobs: JsonStore<PaidJob<W>>;
      quotes: JsonStore<Q>;
      watchFor?: (quote: Q) => W | undefined; // what a watching agent keeps doing afterwards
    },
  ) {}

  schedule(job: PaidJob<W>, attempt = 0): void {
    const wait =
      attempt === 0
        ? Math.max(0, job.startsAt * 1000 - Date.now()) + 4000 // Hedera's clock can lag 2 s
        : RETRY_MS * attempt;
    setTimeout(
      () =>
        void this.process(job.escrowId).catch((e) => {
          // Hedera's RPC can fail for a moment: try again. Nothing is booked twice (the booking
          // id is kept) and a delivery that did land is picked up (see process).
          const again = attempt < MAX_RETRIES;
          console.error(`job ${job.escrowId}: ${e}${again ? " (will retry)" : ""}`);
          if (again) this.schedule(job, attempt + 1);
        }),
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

  private save(job: PaidJob<W>, changes: Partial<PaidJob<W>>): PaidJob<W> {
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
    // Marked delivered before, but the answer was lost (a timeout): just record it.
    if (job.bookingId && ["delivered", "released"].includes(escrow.state))
      return void (await this.delivered(job, job.bookingId, null));
    if (escrow.state !== "held") return;
    const quote = this.d.quotes.get(job.quoteKey);
    if (!quote) return void (await this.refund(job, "quote not found"));

    if (!job.bookingId) {
      job = this.save(job, { status: "booking" });
      // The trip price is in escrow: the agent pays the supplier with a card locked to exactly it.
      const m = this.d.supplier.merchant?.(quote);
      if (quote.priceUnits && m && this.d.cards && !job.card) {
        try {
          const issued = await this.d.cards.issue({
            escrowId,
            merchant: m.name,
            amount: m.amount,
            currency: m.currency,
            amountUnits: quote.priceUnits,
          });
          // The number and code are used to pay, never kept (here or on the job's page).
          const {
            number: _number,
            cvc: _cvc,
            ...card
          } = issued as typeof issued & {
            number?: string;
            cvc?: string;
          };
          job = this.save(job, { card });
        } catch (e) {
          return void (await this.refund(
            job,
            `no card to pay ${m.name}: ${e instanceof Error ? e.message : e}`,
          ));
        }
      }
      try {
        const b = await this.d.supplier.book(quote, job.guest, escrowId.slice(0, 18));
        job = this.save(job, {
          bookingId: b.bookingId,
          confirmation: b.confirmation,
          ...(b.reference ? { reference: b.reference } : {}),
        });
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
    await this.delivered(job, bookingId, r.transactionHash);
  }

  /** Delivered on Hedera: the job says so, a watching agent starts watching, Arkiv records it. */
  private async delivered(job: PaidJob<W>, bookingId: string, tx: Hex | null) {
    const quote = this.d.quotes.get(job.quoteKey);
    const watch = quote && this.d.watchFor?.(quote);
    job = this.save(job, {
      status: "delivered",
      ...(tx ? { deliveredTx: tx } : {}),
      ...(watch ? { watch } : {}), // a watching agent's work goes on
    });
    await recordDelivery(this.d.arkiv, {
      task: job.task,
      agent: this.d.arkiv.address,
      quote: job.quoteKey,
      status: "delivered",
      resultHash: keccak256(toHex(bookingId)),
    }).catch((e) => console.error(`arkiv delivery for ${job.escrowId}: ${e}`));
  }

  /**
   * The buyer reported a problem with a delivered booking. Only if Hedera says the job really is
   * disputed (only the buyer can do that, so nobody else can get a guest's booking cancelled):
   * cancel the booking, stop any watch, and give the fee back. Our policy: a buyer's report is
   * enough.
   */
  async onDispute(escrowId: string, reason: string) {
    const job = this.d.jobs.get(escrowId);
    if (!job) return { outcome: "not_found" as const };
    if (job.status === "refunded") return { outcome: "refunded" as const, cancelled: true };
    const escrow = await this.d.registry.getEscrow(escrowId as Hex);
    if (escrow.state !== "disputed") return { outcome: "not_disputed" as const };
    let cancelled = false;
    if (job.bookingId)
      cancelled = await this.d.supplier
        .cancel(job.bookingId)
        .then(() => true)
        .catch(() => false);
    if (job.watch)
      this.save(job, {
        watch: { ...job.watch, active: false, note: "Stopped: the booking was reported" },
      });
    await this.refund(
      this.d.jobs.get(escrowId) ?? job,
      `Refunded after the buyer's report (${reason})${cancelled ? "; the booking is cancelled" : "; the booking couldn't be cancelled automatically"}`,
    );
    return { outcome: "refunded" as const, cancelled };
  }

  /**
   * The buyer cancels after it was booked. Only the buyer can ask: the request is signed by the
   * limit's owner or its AI key, as Hedera records them for this job's escrow. Our fee stays
   * paid: the booking was made as promised.
   */
  async cancelBooking(escrowId: string, signature: Hex) {
    const job = this.d.jobs.get(escrowId);
    if (!job?.bookingId) return { outcome: "not_found" as const };
    if (job.bookingCancelled) return { outcome: "cancelled" as const };
    const escrow = await this.d.registry.getEscrow(escrowId as Hex);
    const mandate = await this.d.registry.getMandate(escrow.mandateId);
    const signer = await recoverMessageAddress({
      message: cancelBookingMessage(escrowId),
      signature,
    }).catch(() => null);
    const buyers = [mandate.owner, mandate.agent].map((a) => a.toLowerCase());
    if (!signer || !buyers.includes(signer.toLowerCase()))
      return { outcome: "not_the_buyer" as const };
    await this.d.supplier.cancel(job.bookingId);
    // Still in the review window with the price in escrow: everything goes back, fee included.
    if (job.card && escrow.state === "delivered") {
      await this.refund(
        { ...job, bookingCancelled: true },
        "The guest cancelled it in the review window: the booking is cancelled and everything refunded",
      );
      return { outcome: "cancelled" as const };
    }
    this.save(job, {
      bookingCancelled: true,
      ...(job.card ? { card: { ...job.card, status: "voided" as const } } : {}),
      note: job.card
        ? "The guest cancelled it: the booking is cancelled and the hotel refunds the card (simulated)"
        : "The guest cancelled it; the booking is cancelled",
      ...(job.watch
        ? { watch: { ...job.watch, active: false, note: "Stopped: the booking was cancelled" } }
        : {}),
    });
    return { outcome: "cancelled" as const };
  }

  private async refund(job: PaidJob<W>, note: string): Promise<void> {
    const r = await this.d.registry.refund(this.d.agent, job.escrowId);
    // Its card is no longer needed: the price went back with the escrow.
    if (job.card?.status === "authorized")
      await this.d.cards
        ?.void(job.escrowId)
        .catch((e) => console.error(`card void ${job.escrowId}: ${e}`));
    this.save(job, {
      status: "refunded",
      refundTx: r.transactionHash,
      note,
      ...(job.card ? { card: { ...job.card, status: "voided" as const } } : {}),
    });
    await recordDelivery(this.d.arkiv, {
      task: job.task,
      agent: this.d.arkiv.address,
      quote: job.quoteKey,
      status: "refunded",
    }).catch((e) => console.error(`arkiv refund record for ${job.escrowId}: ${e}`));
  }
}
