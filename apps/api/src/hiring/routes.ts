import { Hono } from "hono";
import { currentUser } from "../auth/current";
import { chatStore } from "../chats/store";
import type { Db } from "../db/client";
import { HireError, type HiringService } from "./service";

/** GET /chats/:id/hires (live status for the cards), POST /chats/:id/hires/:hireId/cancel (undo). */
export function hireRoutes(db: Db, hiring: HiringService) {
  const store = chatStore(db);
  const app = new Hono();
  const show = (h: { feeUnits: bigint }) => ({ ...h, feeUnits: h.feeUnits.toString() });

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
    try {
      return c.json(show(await hiring.cancel(user, c.req.param("hireId"))));
    } catch (err) {
      if (err instanceof HireError)
        return c.json({ error: "cannot_cancel", message: err.message }, 409);
      throw err;
    }
  });
  return app;
}
