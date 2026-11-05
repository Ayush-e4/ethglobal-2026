import { formatUsdc } from "@app/shared";
import { Hono } from "hono";
import { z } from "zod";
import { currentUser } from "../auth/current";
import { chatStore } from "../chats/store";
import type { Db } from "../db/client";
import type { Hire } from "../db/schema";
import { HireError, type HiringService } from "./service";

const Id = z.uuid();

/** What the app sees of a hire: enough for its card, nothing internal (agent URLs, keys). */
const show = (h: Hire) => ({
  id: h.id,
  title: h.title,
  agentName: h.agentName,
  feeUnits: h.feeUnits.toString(),
  status: h.status,
  payTx: h.payTx,
  undoUntil: h.undoUntil?.toISOString() ?? null,
  bookingRef: h.bookingRef,
  note: h.note,
});

/** GET /chats/:id/hires (live status for the cards), POST /chats/:id/hires/:hireId/cancel (undo). */
export function hireRoutes(db: Db, hiring: HiringService) {
  const store = chatStore(db);
  const app = new Hono();

  app.get("/chats/:id/hires", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const chat = await store.get(user.id, c.req.param("id"));
    if (!chat) return c.json({ error: "not_found" }, 404);
    return c.json((await hiring.list(chat.id)).map(show));
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
  return app;
}
