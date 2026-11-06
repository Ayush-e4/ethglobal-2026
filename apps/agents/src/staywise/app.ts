import type { SafeArkivWriter } from "@app/arkiv";
import type { MandateClient } from "@app/mandates";
import { checkForm } from "@app/shared";
import type { LiteApiClient } from "@app/travel";
import { MandateServerScheme, NETWORK } from "@app/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { Hono } from "hono";
import type { Hex } from "viem";
import { z } from "zod";
import { escrowIdFromHeader } from "../escrow-id";
import type { JsonStore } from "../store";
import type { StayWiseConfig } from "./config";
import { HOTEL_FORM } from "./form";
import { makeQuotes, toOffer } from "./quotes";
import type { Job, StoredQuote } from "./types";
import type { StayWiseWorker } from "./worker";

const Task = z.string().regex(/^[a-z0-9_.-]{1,64}$/);
/** Test travellers only. */
const BookBody = z.object({
  quote: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  guest: z.object({
    firstName: z.string().min(1).max(40),
    lastName: z.string().min(1).max(40),
    email: z.email(),
    phone: z.string().min(5).max(20),
  }),
});

/**
 * StayWise's API. GET /quote is free; POST /book costs the fee, paid over x402 into escrow with
 * an undo window (StayWise only books after it). GET /jobs/:id says how it went.
 */
export function stayWiseApp(d: {
  config: StayWiseConfig;
  registry: MandateClient;
  lite: LiteApiClient;
  arkiv: SafeArkivWriter;
  quotes: JsonStore<StoredQuote>;
  jobs: JsonStore<Job>;
  worker: StayWiseWorker;
}) {
  const app = new Hono();
  const resource = new x402ResourceServer(
    new HTTPFacilitatorClient({ url: d.config.facilitatorUrl }),
  ).register(NETWORK, new MandateServerScheme([d.config.registryId]));

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

  // Checked before anything is paid: a bad or expired quote never takes money.
  app.post("/book", async (c, next) => {
    const b = BookBody.safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: "bad_request" }, 400);
    const q = d.quotes.get(b.data.quote);
    if (!q || q.expiresAtMs < Date.now()) return c.json({ error: "quote_expired" }, 410);
    await next();
  });

  app.use(
    paymentMiddleware(
      {
        "POST /book": {
          accepts: {
            scheme: "exact",
            network: NETWORK,
            price: d.config.feeUsd,
            payTo: d.config.registryId, // held until the room is booked
            extra: { escrow: { payee: d.arkiv.address, ...d.config.terms } },
          },
          description: "Book the quoted room. Pay on delivery, with an undo window.",
        },
      },
      resource,
    ),
  );

  app.post("/book", async (c) => {
    const b = BookBody.parse(await c.req.json());
    const { escrowId } = escrowIdFromHeader(c.req.header("PAYMENT-SIGNATURE") ?? "");
    const escrow = await d.registry.getEscrow(escrowId);
    const quote = d.quotes.get(b.quote) as StoredQuote;
    if (escrow.state !== "held" || escrow.payee.toLowerCase() !== d.arkiv.address.toLowerCase()) {
      return c.json({ error: "payment_not_held" }, 402);
    }
    const job: Job = {
      escrowId,
      quoteKey: b.quote as Hex,
      task: quote.task,
      guest: b.guest,
      status: "held",
      startsAt: Number(escrow.startsAt),
    };
    d.jobs.set(escrowId, job);
    d.worker.schedule(job);
    return c.json(
      {
        status: "accepted",
        escrowId,
        startsAt: job.startsAt,
        jobUrl: `${d.config.publicUrl}/jobs/${escrowId}`,
      },
      202,
    );
  });

  app.get("/jobs/:id", (c) => {
    const job = d.jobs.get(c.req.param("id"));
    if (!job) return c.json({ error: "not_found" }, 404);
    const { guest: _private, ...shown } = job;
    return c.json(shown);
  });

  app.onError((err, c) => {
    console.error(`staywise: ${err.message}`);
    return c.json({ error: "internal" }, 500);
  });
  return app;
}
