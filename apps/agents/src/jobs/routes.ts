import type { MandateClient } from "@app/mandates";
import { parseUsdc } from "@app/shared";
import { MandateServerScheme, NETWORK } from "@app/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import type { Hono } from "hono";
import type { Hex } from "viem";
import { z } from "zod";
import { escrowIdFromHeader } from "../escrow-id";
import type { JsonStore } from "../store";
import type { Guest, PaidJob, QuoteBase, WatchBase } from "./types";
import type { JobWorker } from "./worker";

/** Test travellers only. */
const GuestBody = z.object({
  firstName: z.string().min(1).max(40),
  lastName: z.string().min(1).max(40),
  email: z.email(),
  phone: z.string().min(5).max(20),
  bornOn: z.iso.date().optional(),
  gender: z.enum(["f", "m"]).optional(),
});
const BookBody = z.object({ quote: z.string().regex(/^0x[0-9a-fA-F]{64}$/), guest: GuestBody });

/** Circle's test USDC on Hedera testnet: what fees and trip prices are paid in. */
const USDC = "0.0.429274";

export interface PaidJobConfig {
  feeUsd: string;
  registryId: string;
  facilitatorUrl: string;
  publicUrl: string;
  terms: { undoSeconds: number; deliverWithinSeconds: number; reviewSeconds: number };
}

/**
 * Any agent's paid routes. POST /book costs the fee, paid over x402 into escrow with an undo
 * window (the work starts after it); a bad or expired quote, or a guest without what this job
 * needs, is refused before anything is paid. GET /jobs/:id says how it went. The buyer can
 * cancel the booking afterwards or report a problem, which only they can do.
 */
export function paidJobRoutes<Q extends QuoteBase, W extends WatchBase>(
  app: Hono,
  d: {
    config: PaidJobConfig;
    registry: MandateClient;
    payee: string; // the agent's address, paid out of escrow
    quotes: JsonStore<Q>;
    jobs: JsonStore<PaidJob<W>>;
    worker: JobWorker<Q, W>;
    what: string; // "Book the quoted room."
    guestProblem?: (g: Guest) => string | null; // e.g. a flight needs the date of birth
  },
) {
  const feeUnits = parseUsdc(d.config.feeUsd.replace("$", ""));
  const totalFor = (key?: string) =>
    (feeUnits + BigInt((key && d.quotes.get(key)?.priceUnits) || "0")).toString();
  const resource = new x402ResourceServer(
    new HTTPFacilitatorClient({ url: d.config.facilitatorUrl }),
  ).register(NETWORK, new MandateServerScheme([d.config.registryId]));

  app.post("/book", async (c, next) => {
    const b = BookBody.safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: "bad_request" }, 400);
    const q = d.quotes.get(b.data.quote);
    if (!q || q.expiresAtMs < Date.now()) return c.json({ error: "quote_expired" }, 410);
    // The price is the fee plus this quote's trip price: the header names the quote it's for.
    if (c.req.header("x-quote") !== b.data.quote)
      return c.json(
        { error: "bad_request", message: "x-quote must name the quote being booked" },
        400,
      );
    const problem = d.guestProblem?.(b.data.guest);
    if (problem) return c.json({ error: "guest_details", message: problem }, 422);
    await next();
  });

  app.use(
    paymentMiddleware(
      {
        "POST /book": {
          accepts: {
            scheme: "exact",
            network: NETWORK,
            // Fee + trip price, in exact USDC units (no rounding through dollars).
            price: (ctx) => ({ asset: USDC, amount: totalFor(ctx.adapter.getHeader("x-quote")) }),
            payTo: d.config.registryId, // held until the job is done
            extra: { escrow: { payee: d.payee, ...d.config.terms } },
          },
          description: `${d.what} Pay on delivery, with an undo window.`,
        },
      },
      resource,
    ),
  );

  app.post("/book", async (c) => {
    const b = BookBody.parse(await c.req.json());
    const { escrowId } = escrowIdFromHeader(c.req.header("PAYMENT-SIGNATURE") ?? "");
    const escrow = await d.registry.getEscrow(escrowId);
    const quote = d.quotes.get(b.quote) as Q;
    if (
      escrow.state !== "held" ||
      escrow.payee.toLowerCase() !== d.payee.toLowerCase() ||
      escrow.amount < BigInt(totalFor(b.quote))
    ) {
      return c.json({ error: "payment_not_held" }, 402);
    }
    const job: PaidJob<W> = {
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
    const { guest: _private, card, ...shown } = job;
    // Of its card, only what a receipt shows: never a number or code.
    return c.json({
      ...shown,
      ...(card
        ? { card: { last4: card.last4, merchant: card.merchant, status: card.status } }
        : {}),
    });
  });

  // The buyer cancels the booking after it was made, with a signature only the buyer can make.
  app.post("/jobs/:id/cancel-booking", async (c) => {
    const body = z
      .object({ signature: z.string().regex(/^0x[0-9a-fA-F]+$/) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const r = await d.worker.cancelBooking(c.req.param("id"), body.data.signature as Hex);
    const status = { not_found: 404, not_the_buyer: 403, cancelled: 200 }[r.outcome];
    return c.json(r, status as 200);
  });

  // The buyer reported a problem (and disputed the escrow on Hedera, which we check first).
  app.post("/jobs/:id/dispute", async (c) => {
    const body = z
      .object({ reason: z.string().max(200).optional() })
      .safeParse(await c.req.json().catch(() => ({})));
    const r = await d.worker.onDispute(
      c.req.param("id"),
      body.success ? (body.data.reason ?? "no reason given") : "no reason given",
    );
    return c.json(r, r.outcome === "not_found" ? 404 : r.outcome === "not_disputed" ? 409 : 200);
  });
}
