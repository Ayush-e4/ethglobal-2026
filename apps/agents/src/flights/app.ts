import type { SafeArkivWriter } from "@app/arkiv";
import type { MandateClient } from "@app/mandates";
import { checkForm } from "@app/shared";
import type { DuffelClient } from "@app/travel";
import { Hono } from "hono";
import { z } from "zod";
import { paidJobRoutes } from "../jobs/routes";
import type { JobWorker } from "../jobs/worker";
import type { JsonStore } from "../store";
import type { FlightAgentConfig } from "./config";
import { FLIGHT_FORM } from "./form";
import { inrRates } from "./fx";
import { makeFlightQuotes, toFlightOffer } from "./quotes";
import { passengerProblem } from "./supplier";
import type { FlightJob, FlightQuote } from "./types";

const Task = z.string().regex(/^[a-z0-9_.-]{1,64}$/);

/** SkyHop's API: GET /quote is free; the paid routes (book, follow, cancel, report) are every agent's. */
export function flightAgentApp(d: {
  config: FlightAgentConfig;
  registry: MandateClient;
  duffel: DuffelClient;
  arkiv: SafeArkivWriter;
  quotes: JsonStore<FlightQuote>;
  jobs: JsonStore<FlightJob>;
  worker: JobWorker<FlightQuote>;
}) {
  const app = new Hono();
  const inrRate = inrRates();
  app.get("/health", (c) => c.json({ ok: true, agent: d.arkiv.address }));

  app.get("/quote", async (c) => {
    const task = Task.safeParse(c.req.query("task"));
    const filled = checkForm(FLIGHT_FORM, c.req.query(), { coerce: true });
    if (!task.success || !filled.ok)
      return c.json({ error: "bad_request", issues: filled.ok ? ["task"] : filled.problems }, 400);
    const v = filled.values as { from: string; to: string; date: string; returnDate?: string };
    const today = new Date().toISOString().slice(0, 10);
    const issues = [
      v.from === v.to && "from and to must differ",
      v.date < today && "date must not be in the past",
      v.returnDate && v.returnDate < v.date && "returnDate must not be before date",
    ].filter(Boolean);
    if (issues.length) return c.json({ error: "bad_request", issues }, 400);
    const quotes = await makeFlightQuotes(
      { ...d, feeUsd: d.config.feeUsd, inrRate },
      { ...v, task: task.data },
    );
    if (quotes.length === 0) return c.json({ error: "no_flights" }, 404);
    return c.json({ offers: quotes.map(toFlightOffer) });
  });

  paidJobRoutes(app, {
    ...d,
    payee: d.arkiv.address,
    what: "Book the quoted flight.",
    guestProblem: passengerProblem,
  });

  app.onError((err, c) => {
    console.error(`skyhop: ${err.message}`);
    return c.json({ error: "internal" }, 500);
  });
  return app;
}
