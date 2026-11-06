import { Hono } from "hono";
import { currentUser } from "../auth/current";
import type { Db } from "../db/client";
import { DealError, type DealService } from "./service";

/**
 * Deal drops: GET /deals (what's on, how many are left, yours), POST /deals/:id/start (a
 * signed World ID request for it), POST /deals/:id/claim (the proof: one per person).
 */
export function dealRoutes(db: Db, deals: DealService) {
  const app = new Hono();
  app.get("/deals", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    return c.json({ available: deals.available(), drops: await deals.list(user) });
  });
  for (const step of ["start", "claim"] as const) {
    app.post(`/deals/:id/${step}`, async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "signed_out" }, 401);
      try {
        if (step === "start") return c.json(await deals.start(user, c.req.param("id")));
        const claim = await deals.claim(
          user,
          c.req.param("id"),
          await c.req.json().catch(() => null),
        );
        return c.json({ status: claim.status });
      } catch (err) {
        if (err instanceof DealError)
          return c.json({ error: "refused", message: err.message }, 409);
        throw err;
      }
    });
  }
  return app;
}
