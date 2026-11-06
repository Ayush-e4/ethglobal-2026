import type { MandateClient } from "@app/mandates";
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
const Job = z.object({
  status: z.string(),
  bookingId: z.string().optional(),
  confirmation: z.string().optional(),
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
) {
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
        await set(hire.id, { status: hire.note?.startsWith("undone") ? "cancelled" : "refunded" });
        if (!hire.note?.startsWith("undone"))
          await chats.add(
            hire.chatId,
            "assistant",
            `${hire.agentName} couldn't do it and refunded the fee. Nothing was charged.`,
          );
        return;
      }
      const res = hire.jobUrl
        ? await fetch(hire.jobUrl, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
        : null;
      const job = Job.safeParse(res?.ok ? await res.json() : null);
      if (job.success && job.data.status === "delivered") {
        const w = job.data.watch;
        await set(hire.id, {
          status: "delivered",
          bookingRef: job.data.bookingId ?? null,
          ...(w ? { watching: w.active, watchNote: watchNote(w) } : {}),
        });
        await chats.add(
          hire.chatId,
          "assistant",
          `Booked: ${hire.title}. Booking reference ${job.data.bookingId ?? "pending"}. ${hire.agentName} is paid automatically by Hedera when the review window ends.`,
        );
      }
    } else if (hire.status === "delivered" && escrow.state === "released") {
      await set(hire.id, { status: "released" });
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
        .where(or(inArray(hires.status, ["held", "delivered"]), eq(hires.watching, true)));
      for (const hire of open)
        await step(hire).catch((e) =>
          console.error(`hire ${hire.id}: ${e instanceof Error ? e.message : e}`),
        );
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
