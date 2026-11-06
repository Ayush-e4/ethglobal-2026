import type { SafeArkivWriter } from "@app/arkiv";
import type { MandateClient } from "@app/mandates";
import { checkForm } from "@app/shared";
import type { LiteApiClient } from "@app/travel";
import { Hono } from "hono";
import { z } from "zod";
import { paidJobRoutes } from "../jobs/routes";
import type { JsonStore } from "../store";
import type { HotelAgentConfig } from "./config";
import { HOTEL_FORM } from "./form";
import { makeQuotes, toOffer } from "./quotes";
import type { Job, StoredQuote } from "./types";
import type { PriceWatcher } from "./watch";
import type { HotelWorker } from "./worker";

const Task = z.string().regex(/^[a-z0-9_.-]{1,64}$/);

/**
 * A hotel agent's API. GET /quote is free; the paid routes (book, follow, cancel, report) are
 * every agent's (jobs/routes.ts). A watching agent's job also says how its watch is going.
 */
export function hotelAgentApp(d: {
  config: HotelAgentConfig;
  registry: MandateClient;
  lite: LiteApiClient;
  arkiv: SafeArkivWriter;
  quotes: JsonStore<StoredQuote>;
  jobs: JsonStore<Job>;
  worker: HotelWorker;
  watcher?: PriceWatcher | null;
}) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, agent: d.arkiv.address }));

  // The market's protocol: the form from our Arkiv listing in, offers (each signed on Arkiv) out.
  app.get("/quote", async (c) => {
    const task = Task.safeParse(c.req.query("task"));
    const filled = checkForm(HOTEL_FORM, c.req.query(), { coerce: true });
    if (!task.success || !filled.ok)
      return c.json({ error: "bad_request", issues: filled.ok ? ["task"] : filled.problems }, 400);
    const v = filled.values as {
      iata: string;
      checkin: string;
      checkout: string;
      adults: number;
      area?: string;
      maxTotal?: number;
      minStars?: number;
    };
    if (v.checkout <= v.checkin)
      return c.json({ error: "bad_request", issues: ["checkout must be after checkin"] }, 400);
    const quotes = await makeQuotes(
      { ...d, feeUsd: d.config.feeUsd },
      { ...v, task: task.data, iataCode: v.iata },
    );
    if (quotes.length === 0) return c.json({ error: "no_rooms" }, 404);
    return c.json({ offers: quotes.map(toOffer) });
  });

  paidJobRoutes(app, {
    ...d,
    payee: d.arkiv.address,
    what: "Book the quoted room.",
  });

  // Demo only, and only with the demo token: the next price check sees the room this much
  // cheaper. The rebook that follows is real (in the sandbox) and labelled as simulated.
  app.post("/jobs/:id/demo-drop", async (c) => {
    if (!d.watcher || !d.config.demoToken || c.req.header("x-demo-token") !== d.config.demoToken)
      return c.json({ error: "not_found" }, 404);
    const body = z
      .object({ inr: z.number().int().min(200).max(20000) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    if (!d.watcher.simulateDrop(c.req.param("id"), body.data.inr))
      return c.json({ error: "not_watching" }, 409);
    const rebook = await d.watcher.check(c.req.param("id"));
    return c.json({ rebook });
  });

  app.onError((err, c) => {
    console.error(`${d.config.id}: ${err.message}`);
    return c.json({ error: "internal" }, 500);
  });
  return app;
}
