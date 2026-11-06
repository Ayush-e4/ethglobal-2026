import type { MandateClient } from "@app/mandates";
import { formatUsdc } from "@app/shared";
import { and, eq, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";
import type { ChatStore } from "../chats/store";
import type { Db } from "../db/client";
import { type Hire, hires } from "../db/schema";

const Rebook = z.object({
  from: z.number(),
  to: z.number(),
  saved: z.number(),
  currency: z.string().max(5),
  toBookingId: z.string().max(80),
  simulated: z.boolean(),
});
export type Rebook = z.infer<typeof Rebook>;

const Job = z.object({
  status: z.string(),
  bookingId: z.string().optional(),
  confirmation: z.string().optional(),
  reference: z.string().optional(), // what the guest quotes, when it isn't the booking id
  note: z.string().optional(),
  // A watching agent's watch over the room's price, after delivery.
  watch: z
    .object({ active: z.boolean(), checkin: z.string(), rebooks: z.array(Rebook).max(50) })
    .optional(),
});

const money = (n: number, currency: string) =>
  currency === "INR" ? `₹${Math.round(n).toLocaleString("en-IN")}` : `${Math.round(n)} ${currency}`;
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/** "Saved ₹800 · 1 rebook · watching the price until 20 Dec" */
export function watchNote(w: NonNullable<z.infer<typeof Job>["watch"]>) {
  const saved = w.rebooks.reduce((s, r) => s + r.saved, 0);
  const currency = w.rebooks[0]?.currency ?? "INR";
  const parts = [
    w.rebooks.length ? `Saved ${money(saved, currency)}` : null,
    w.rebooks.length ? `${w.rebooks.length} rebook${w.rebooks.length === 1 ? "" : "s"}` : null,
    w.active ? `watching the price until ${day(w.checkin)}` : "watch over",
  ];
  return parts.filter(Boolean).join(" · ");
}

/**
 * Follows every open hire to the end, from the database, so a restart loses nothing: asks the
 * agent how its job is going and reads the escrow on Hedera. Posts the result into the chat.
 * A hire cut off mid-payment (status still "paying" after a restart) is marked failed for a
 * check, never paid again.
 */
export function hireFollower(
  db: Db,
  registry: MandateClient,
  chats: Pick<ChatStore, "add">,
  everyMs = 5000,
  hooks: {
    onChange?: (hireId: string) => Promise<unknown>; // after each look at a hire (Telegram's live message)
    onBooked?: (hire: Hire, bookingRef: string) => Promise<unknown>; // the confirmation email
    onRebooked?: (hire: Hire, rebook: Rebook) => Promise<unknown>;
    onDisputeSettled?: (hire: Hire) => Promise<unknown>; // the agent refunded after a report
    onRefunded?: (hire: Hire, why: "not_booked" | "report") => Promise<unknown>; // the guest's email
    onReleased?: (hire: Hire) => Promise<unknown>; // the agent was paid (a deal pays its fee back)
  } = {},
) {
  const { onChange } = hooks;
  const tell = (what: string, p: Promise<unknown> | undefined) =>
    p?.catch((e) => console.error(`hire ${what}: ${e instanceof Error ? e.message : e}`));
  let running = false;
  const set = (id: string, changes: Partial<Hire>) =>
    db
      .update(hires)
      .set({ ...changes, updatedAt: new Date() })
      .where(inArray(hires.id, [id]));

  async function step(hire: Hire) {
    if (!hire.escrowId) return;
    const escrow = await registry.getEscrow(hire.escrowId as `0x${string}`);
    if (hire.status === "held") {
      if (escrow.state === "refunded") {
        // "undoing" / "undone": the user undid it (hiring.cancel), not the agent giving up.
        const undone = hire.note?.startsWith("undo") ?? false;
        await set(hire.id, { status: undone ? "cancelled" : "refunded" });
        if (!undone) {
          await chats.add(
            hire.chatId,
            "assistant",
            `${hire.agentName} couldn't do it and refunded the fee. Nothing was charged.`,
          );
          await tell("email", hooks.onRefunded?.({ ...hire, status: "refunded" }, "not_booked"));
        }
        return;
      }
      const res = hire.jobUrl
        ? await fetch(hire.jobUrl, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
        : null;
      const job = Job.safeParse(res?.ok ? await res.json() : null);
      if (job.success && job.data.status === "delivered") {
        const w = job.data.watch;
        const ref = job.data.reference ?? job.data.bookingId;
        const reviewEnds = Number(escrow.deliveredAt) + escrow.reviewSeconds;
        await set(hire.id, {
          status: "delivered",
          bookingRef: ref ?? null,
          reviewUntil: escrow.deliveredAt > 0n ? new Date(reviewEnds * 1000) : null,
          ...(w ? { watching: w.active, watchNote: watchNote(w) } : {}),
        });
        await chats.add(
          hire.chatId,
          "assistant",
          `Booked: ${hire.title}. Booking reference ${ref ?? "pending"}. ${hire.agentName} is paid automatically by Hedera when the review window ends.`,
        );
        if (ref) await tell("email", hooks.onBooked?.(hire, ref));
      }
    } else if (hire.status === "delivered" && escrow.state === "refunded") {
      // Cancelled in the review window with the trip price in escrow: the agent gave it all back.
      await set(hire.id, {
        status: "refunded",
        watching: false,
        bookingCancelledAt: hire.bookingCancelledAt ?? new Date(),
        note: "cancelled in the review window: everything refunded",
      });
      await chats.add(
        hire.chatId,
        "assistant",
        `${hire.agentName} cancelled ${hire.title} and refunded everything: the trip price and its fee.`,
      );
      await tell("email", hooks.onRefunded?.({ ...hire, status: "refunded" }, "not_booked"));
      return;
    } else if (hire.status === "disputed" && escrow.state === "refunded") {
      // The agent settled the buyer's report by giving the fee back.
      const res = hire.jobUrl
        ? await fetch(hire.jobUrl, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
        : null;
      const note = (
        (res?.ok ? await res.json().catch(() => null) : null) as { note?: string } | null
      )?.note;
      await set(hire.id, {
        status: "refunded",
        watching: false,
        note: note ?? "refunded after your report",
      });
      await chats.add(
        hire.chatId,
        "assistant",
        `${hire.agentName} accepted your report on ${hire.title}: the ${formatUsdc(hire.feeUnits)} USDC fee is refunded${note?.includes("booking is cancelled") ? ", and the booking is cancelled" : ""}.`,
      );
      await tell("dispute", hooks.onDisputeSettled?.(hire));
      await tell(
        "email",
        hooks.onRefunded?.({ ...hire, status: "refunded", note: note ?? hire.note }, "report"),
      );
      return;
    } else if (hire.status === "delivered" && escrow.state === "released") {
      await set(hire.id, { status: "released" });
      await tell("deal", hooks.onReleased?.({ ...hire, status: "released" }));
    }
    if (hire.watching) await watchStep(hire);
  }

  /** A watching agent's work after delivery: each rebook is told in the chat, once. */
  async function watchStep(hire: Hire) {
    const res = hire.jobUrl
      ? await fetch(hire.jobUrl, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
      : null;
    const job = Job.safeParse(res?.ok ? await res.json() : null);
    const w = job.success ? job.data.watch : undefined;
    if (!w) return;
    for (const r of w.rebooks.slice(hire.rebooksSeen)) {
      const demo = r.simulated
        ? " (A simulated price drop, for the demo: the rebook itself is real, in the sandbox.)"
        : "";
      await chats.add(
        hire.chatId,
        "assistant",
        `${hire.agentName} found the same room cheaper and rebooked it: ${money(r.from, r.currency)} → ${money(r.to, r.currency)}, so ${money(r.saved, r.currency)} comes back to you. New booking reference ${r.toBookingId}.${demo}`,
      );
      await tell("email", hooks.onRebooked?.(hire, r));
    }
    await set(hire.id, {
      watching: w.active,
      rebooksSeen: w.rebooks.length,
      watchNote: watchNote(w),
      bookingRef: w.rebooks.at(-1)?.toBookingId ?? hire.bookingRef,
    });
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      const open = await db
        .select()
        .from(hires)
        .where(
          or(inArray(hires.status, ["held", "delivered", "disputed"]), eq(hires.watching, true)),
        );
      for (const hire of open)
        await step(hire)
          .catch((e) => console.error(`hire ${hire.id}: ${e instanceof Error ? e.message : e}`))
          .then(() => onChange?.(hire.id));
    } finally {
      running = false;
    }
  }

  return {
    async start() {
      const cutoff = new Date(Date.now() - 3 * 60_000);
      // A hire still "paying" from before the restart: its outcome is unknown, so flag it, never pay again.
      await db
        .update(hires)
        .set({
          status: "failed",
          note: "cut off mid-payment by a restart: check the limit before retrying",
          updatedAt: new Date(),
        })
        .where(and(eq(hires.status, "paying"), lt(hires.updatedAt, cutoff)));
      const timer = setInterval(() => void tick(), everyMs);
      return () => clearInterval(timer);
    },
    tick,
  };
}
