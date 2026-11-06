import { ARKIV_EXPLORER } from "@app/arkiv";
import { Hono } from "hono";
import { z } from "zod";
import { currentUser } from "../auth/current";
import { chatStore } from "../chats/store";
import type { Db } from "../db/client";
import { checkView, type WorldChecks } from "./checks";
import { rateable, type WorldRatings } from "./ratings";

const Rate = z.object({ score: z.number().int().min(1).max(5) });

/**
 * Rating a hire's agent from its card, once the job is done. GET: can this be rated, is the
 * account a verified person already, and its rating of this agent. POST `{ score }`: a verified
 * account's rating is posted at once; otherwise a World ID check starts, and the rating is posted
 * when it passes (the card follows the check).
 */
export function ratingRoutes(db: Db, ratings: WorldRatings, checks: WorldChecks | null) {
  const store = chatStore(db);
  const app = new Hono();

  const load = async (userId: string, chatId: string, hireId: string) => {
    const chat = await store.get(userId, chatId).catch(() => null);
    const hire = chat ? await ratings.hireOf(userId, hireId).catch(() => null) : null;
    return hire && hire.chatId === chat?.id ? hire : null;
  };
  const view = (r: Awaited<ReturnType<WorldRatings["mine"]>>) =>
    r && {
      score: r.score,
      status: r.status,
      entity: r.arkivKey ? ARKIV_EXPLORER.entity(r.arkivKey) : null,
    };

  app.get("/chats/:id/hires/:hireId/rating", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const hire = await load(user.id, c.req.param("id"), c.req.param("hireId"));
    if (!hire) return c.json({ error: "not found" }, 404);
    return c.json({
      canRate: rateable(hire) && Boolean(user.worldSub || checks),
      verified: Boolean(user.worldSub),
      rating: view(await ratings.mine(user.id, hire.agent)),
    });
  });

  app.post("/chats/:id/hires/:hireId/rating", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const body = Rate.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "a rating is 1 to 5 stars" }, 400);
    const hire = await load(user.id, c.req.param("id"), c.req.param("hireId"));
    if (!hire) return c.json({ error: "not found" }, 404);
    if (!rateable(hire)) return c.json({ error: "Rate it once the job is done" }, 409);
    const { score } = body.data;
    if (user.worldIss && user.worldSub) {
      const note = await ratings.rate(user.id, hire.id, score, {
        iss: user.worldIss,
        sub: user.worldSub,
      });
      return c.json({ rating: view(await ratings.mine(user.id, hire.agent)), note });
    }
    if (!checks) return c.json({ error: "World ID isn't set up on this server" }, 503);
    const check = await checks.start(user.id, "rate", `${hire.id}:${score}`).catch((e) => e);
    if (check instanceof Error) return c.json({ error: check.message }, 502);
    return c.json({ check: checkView(check) }, 201);
  });

  return app;
}
