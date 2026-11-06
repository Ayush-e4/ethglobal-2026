import { count, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/client";
import { agentReviews, hires, lookups, payRequests, users } from "../db/schema";

/**
 * GET /stats, public: what the network has done, for the landing page. Counts only (nothing
 * about anyone), kept for a minute so a busy page doesn't hammer the database.
 */
export function statsRoutes(db: Db) {
  const app = new Hono();
  let cached: { at: number; body: Record<string, number> } | null = null;
  app.get("/stats", async (c) => {
    if (cached && Date.now() - cached.at < 60_000) return c.json(cached.body);
    const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
    const body = {
      agents: await n(
        db.select({ n: count() }).from(agentReviews).where(eq(agentReviews.status, "approved")),
      ),
      jobs: await n(
        db
          .select({ n: count() })
          .from(hires)
          .where(inArray(hires.status, ["held", "delivered", "released", "disputed", "refunded"])),
      ),
      lookups: await n(
        db.select({ n: count() }).from(lookups).where(eq(lookups.status, "answered")),
      ),
      shopPayments: await n(
        db.select({ n: count() }).from(payRequests).where(eq(payRequests.status, "paid")),
      ),
      people: await n(db.select({ n: count() }).from(users).where(eq(users.isDemo, false))),
    };
    cached = { at: Date.now(), body };
    return c.json(body);
  });
  return app;
}
