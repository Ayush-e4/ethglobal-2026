import type { MandateClient } from "@app/mandates";
import { and, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import type { ChatStore } from "../chats/store";
import type { Db } from "../db/client";
import { type Hire, hires } from "../db/schema";

const Job = z.object({
  status: z.string(),
  bookingId: z.string().optional(),
  confirmation: z.string().optional(),
  note: z.string().optional(),
});

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
        await set(hire.id, { status: "delivered", bookingRef: job.data.bookingId ?? null });
        await chats.add(
          hire.chatId,
          "assistant",
          `Booked: ${hire.title}. Booking reference ${job.data.bookingId ?? "pending"}. ${hire.agentName} is paid automatically by Hedera when the review window ends.`,
        );
      }
    } else if (hire.status === "delivered" && escrow.state === "released") {
      await set(hire.id, { status: "released" });
    }
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      const open = await db
        .select()
        .from(hires)
        .where(inArray(hires.status, ["held", "delivered"]));
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
