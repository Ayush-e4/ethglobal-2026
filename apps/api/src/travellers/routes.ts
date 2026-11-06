import { Hono } from "hono";
import { z } from "zod";
import { currentUser } from "../auth/current";
import type { Db } from "../db/client";
import type { Traveller } from "../db/schema";
import { GuestSchema, MAX_TRAVELLERS, TravellerError, type TravellerService } from "./service";

const Body = GuestSchema.extend({ isSelf: z.boolean().optional() });
const Choose = z.object({ travellerId: z.uuid() });

const view = (t: Traveller) => ({
  id: t.id,
  firstName: t.firstName,
  lastName: t.lastName,
  email: t.email,
  phone: t.phone,
  isSelf: t.isSelf,
});

/**
 * Your saved travellers (GET/POST /travellers, PATCH/DELETE /travellers/:id; up to 5), and who a
 * chat's bookings are for (GET/POST /chats/:id/traveller). Only the account sees its travellers.
 */
export function travellerRoutes(db: Db, t: TravellerService) {
  const app = new Hono();
  const problem = (err: unknown) =>
    err instanceof TravellerError ? err.message : "Couldn't save the traveller";
  const invalid = (e: z.ZodError) => e.issues[0]?.message ?? "check the details";

  app.get("/travellers", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    return c.json({ travellers: (await t.list(user.id)).map(view), max: MAX_TRAVELLERS });
  });

  app.post("/travellers", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const b = Body.safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: invalid(b.error) }, 400);
    const { isSelf, ...guest } = b.data;
    try {
      return c.json({ traveller: view(await t.add(user.id, guest, isSelf)) }, 201);
    } catch (err) {
      return c.json({ error: problem(err) }, 409);
    }
  });

  app.patch("/travellers/:id", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const b = Body.safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: invalid(b.error) }, 400);
    const { isSelf, ...guest } = b.data;
    try {
      return c.json({ traveller: view(await t.update(user.id, c.req.param("id"), guest, isSelf)) });
    } catch (err) {
      return c.json({ error: problem(err) }, 404);
    }
  });

  app.delete("/travellers/:id", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    return (await t.remove(user.id, c.req.param("id")))
      ? c.json({ ok: true })
      : c.json({ error: "not found" }, 404);
  });

  app.get("/chats/:id/traveller", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const chosen = await t.chosen(user.id, c.req.param("id"));
    return c.json({ traveller: chosen ? view(chosen) : null });
  });

  app.post("/chats/:id/traveller", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const b = Choose.safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: "give a traveller id" }, 400);
    return (await t.choose(user.id, c.req.param("id"), b.data.travellerId))
      ? c.json({ ok: true })
      : c.json({ error: "not found" }, 404);
  });

  return app;
}
