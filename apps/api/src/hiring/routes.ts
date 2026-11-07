import { ARKIV_EXPLORER } from "@app/arkiv";
import { formatUsdc } from "@app/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { currentUser } from "../auth/current";
import { chatStore } from "../chats/store";
import type { Db } from "../db/client";
import { type Hire, quotes } from "../db/schema";
import { canCancelBooking } from "./cancel-booking";
import { DisputeReasonSchema, reportedNote } from "./disputes";
import { HireError, type HiringService } from "./service";

const Id = z.uuid();

/** What the app sees of a hire: enough for its card, nothing internal (agent URLs, keys). */
export const show = (h: Hire) => ({
  id: h.id,
  title: h.title,
  agentName: h.agentName,
  feeUnits: h.feeUnits.toString(),
  priceUnits: h.priceUnits?.toString() ?? null, // the trip price in the same escrow (testnet scale)
  card: h.card ?? null, // the one-time card the agent paid the supplier with
  status: h.status,
  payTx: h.payTx,
  offerUrl: ARKIV_EXPLORER.entity(h.quoteKey), // the agent's signed offer on Arkiv
  undoUntil: h.undoUntil?.toISOString() ?? null,
  bookingRef: h.bookingRef,
  note: h.note,
  watching: h.watching, // a watching agent still at work after it's paid
  watchNote: h.watchNote,
  reviewUntil: h.reviewUntil?.toISOString() ?? null,
  canReport: h.status === "delivered" && !!h.reviewUntil && h.reviewUntil > new Date(),
  bookingCancelledAt: h.bookingCancelledAt?.toISOString() ?? null,
  canCancelBooking: canCancelBooking(h),
  guestName: h.guestName,
  chatId: h.chatId,
  createdAt: h.createdAt.toISOString(),
});

/** GET /chats/:id/hires (live status for the cards), POST /chats/:id/hires/:hireId/cancel (undo). */
export function hireRoutes(db: Db, hiring: HiringService, demoToken?: string) {
  const store = chatStore(db);
  const app = new Hono();

  app.get("/chats/:id/hires", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const chat = await store.get(user.id, c.req.param("id"));
    if (!chat) return c.json({ error: "not_found" }, 404);
    // With the demo on, a watching hire's card can simulate a price drop.
    const canDemo = (h: Hire) => !!demoToken && h.watching;
    return c.json(
      (await hiring.list(chat.id)).map((h) => ({ ...show(h), canSimulateDrop: canDemo(h) })),
    );
  });

  app.post("/chats/:id/hires/:hireId/cancel", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const chat = await store.get(user.id, c.req.param("id"));
    const hireId = Id.safeParse(c.req.param("hireId"));
    if (!chat || !hireId.success) return c.json({ error: "not_found" }, 404);
    try {
      const hire = await hiring.cancel(user, chat.id, hireId.data);
      // Said in the chat too, so the concierge knows it was undone when the user writes next.
      await store.add(
        chat.id,
        "assistant",
        `Undone: ${hire.title} wasn't booked, and the ${formatUsdc(hire.feeUnits)} USDC fee is back on your limit.`,
      );
      return c.json(show(hire));
    } catch (err) {
      if (err instanceof HireError)
        return c.json({ error: "cannot_cancel", message: err.message }, 409);
      throw err;
    }
  });
  // Cancel a booked stay at the hotel, after the undo window (cancel-booking.ts).
  app.post("/chats/:id/hires/:hireId/cancel-booking", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const chat = await store.get(user.id, c.req.param("id"));
    const hireId = Id.safeParse(c.req.param("hireId"));
    if (!chat || !hireId.success) return c.json({ error: "not_found" }, 404);
    try {
      const hire = await hiring.cancelBooking(user, chat.id, hireId.data);
      await store.add(
        chat.id,
        "assistant",
        `Cancelled: ${hire.title}. ${hire.agentName} cancelled it with the hotel or airline. Its ${formatUsdc(hire.feeUnits)} USDC fee stays paid: the booking was made as promised.`,
      );
      return c.json(show(hire));
    } catch (err) {
      if (err instanceof HireError)
        return c.json({ error: "cannot_cancel", message: err.message }, 409);
      throw err;
    }
  });

  // Report a problem with a delivered booking, within its review window (disputes.ts).
  app.post("/chats/:id/hires/:hireId/dispute", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const chat = await store.get(user.id, c.req.param("id"));
    const hireId = Id.safeParse(c.req.param("hireId"));
    const body = z
      .object({ reason: DisputeReasonSchema })
      .safeParse(await c.req.json().catch(() => null));
    if (!chat || !hireId.success) return c.json({ error: "not_found" }, 404);
    if (!body.success) return c.json({ error: "bad_request", message: "pick a reason" }, 400);
    try {
      const hire = await hiring.dispute(user, chat.id, hireId.data, body.data.reason);
      await store.add(chat.id, "assistant", reportedNote(hire, body.data.reason));
      return c.json(show(hire));
    } catch (err) {
      if (err instanceof HireError)
        return c.json({ error: "cannot_report", message: err.message }, 409);
      throw err;
    }
  });

  // Demo only (needs DEMO_TOKEN set): tell a watching agent the room got cheaper. The agent's
  // rebook is real (in the sandbox), and the chat says the drop was simulated.
  app.post("/chats/:id/hires/:hireId/demo-drop", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const chat = await store.get(user.id, c.req.param("id"));
    const hireId = Id.safeParse(c.req.param("hireId"));
    if (!demoToken || !chat || !hireId.success) return c.json({ error: "not_found" }, 404);
    const hire = (await hiring.list(chat.id)).find((h) => h.id === hireId.data);
    if (!hire?.watching || !hire.jobUrl) return c.json({ error: "not_watching" }, 409);
    // The demo token only ever goes to our own agents, never to a listed third party's job link.
    const [q] = await db
      .select({ agent: quotes.agentAddress })
      .from(quotes)
      .where(eq(quotes.key, hire.quoteKey));
    if (!q || !houseAgents().has(q.agent.toLowerCase()))
      return c.json(
        { error: "not_ours", message: "Only our own agents take a simulated drop." },
        409,
      );
    const res = await fetch(`${hire.jobUrl}/demo-drop`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-token": demoToken },
      body: JSON.stringify({ inr: 800 }),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);
    if (!res?.ok) return c.json({ error: "failed", message: "The agent didn't take it." }, 502);
    return c.json(await res.json());
  });
  return app;
}

/** Our own agents (HOUSE_AGENTS, lowercase addresses). */
const houseAgents = () =>
  new Set(
    (process.env.HOUSE_AGENTS ?? "")
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean),
  );
