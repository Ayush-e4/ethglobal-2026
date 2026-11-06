import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { currentUser } from "../auth/current";
import type { Db } from "../db/client";
import { oauthClients, oauthGrants } from "../db/schema";

/** Connected apps, in the wallet: see them (GET /oauth/grants), disconnect one (DELETE). */
export function grantRoutes(db: Db) {
  const app = new Hono();
  app.get("/oauth/grants", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const rows = await db
      .select({ grant: oauthGrants, app: oauthClients.name })
      .from(oauthGrants)
      .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
      .where(and(eq(oauthGrants.userId, user.id), isNull(oauthGrants.revokedAt)))
      .orderBy(desc(oauthGrants.createdAt));
    return c.json(
      rows.map((r) => ({
        id: r.grant.id,
        app: r.app,
        chatId: r.grant.chatId,
        connectedAt: r.grant.createdAt.toISOString(),
        lastUsedAt: r.grant.lastUsedAt?.toISOString() ?? null,
      })),
    );
  });
  app.delete("/oauth/grants/:id", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    if (!z.uuid().safeParse(c.req.param("id")).success) return c.json({ error: "not_found" }, 404);
    const done = await db
      .update(oauthGrants)
      .set({ revokedAt: new Date() })
      .where(and(eq(oauthGrants.id, c.req.param("id")), eq(oauthGrants.userId, user.id)))
      .returning();
    return done.length ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
  });

  return app;
}
