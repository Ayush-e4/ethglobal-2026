import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { currentUser } from "../auth/current";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import type { Email, TryEmail } from "../email/resend";

const Body = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(120)).nullable(),
});
const TEST_EVERY_MS = 30_000;

/** The account's own email, for routes and for the emails that copy it. */
export const accountEmailOf = (db: Db) => async (userId: string) =>
  (await db.select({ email: users.email }).from(users).where(eq(users.id, userId)))[0]?.email ??
  null;

/**
 * The account's email (GET/PUT /account/email): account notices and a copy of each booking
 * email go there. POST /account/email/test sends a test and says exactly why it didn't go.
 */
export function emailRoutes(
  db: Db,
  d: { available: boolean; tryEmail: TryEmail; test: (to: string) => Email },
) {
  const app = new Hono();
  const lastTest = new Map<string, number>();

  app.get("/account/email", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    return c.json({ email: user.email, available: d.available });
  });

  app.put("/account/email", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const b = Body.safeParse(await c.req.json().catch(() => null));
    if (!b.success)
      return c.json({ error: "bad_request", message: "That isn't an email address." }, 400);
    const email = b.data.email;
    await db.update(users).set({ email }).where(eq(users.id, user.id));
    return c.json({ email });
  });

  app.post("/account/email/test", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    if (!user.email) return c.json({ error: "no_email", message: "Save an email first." }, 400);
    const last = lastTest.get(user.id) ?? 0;
    if (Date.now() - last < TEST_EVERY_MS)
      return c.json({ error: "too_soon", message: "Wait a few seconds before another test." }, 429);
    lastTest.set(user.id, Date.now());
    const r = await d.tryEmail(d.test(user.email));
    return c.json(r.ok ? { sent: true } : { sent: false, error: r.error });
  });

  return app;
}
