import { type Answer, AnswerSchema, checkForm, type Form } from "@app/shared";
import { MandateServerScheme, NETWORK } from "@app/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import type { Hono } from "hono";

/**
 * A lookup agent's paid route, GET /answer: its fee per lookup, paid straight to its own Hedera
 * account (no escrow: the answer is the delivery). The answer is found before payment is asked
 * for, so a lookup that finds nothing (or fails) is never charged; once paid, it's returned.
 */
export function lookupRoutes(
  app: Hono,
  d: {
    feeUsd: string; // per lookup, e.g. "$0.001"
    accountId: string; // its Hedera account: where it's paid
    facilitatorUrl: string;
    form: Form;
    what: string; // "Look up an IFSC code."
    answer: (input: Record<string, unknown>) => Promise<Answer | null>; // null: nothing found
  },
) {
  const found = new WeakMap<Request, Answer>();
  const resource = new x402ResourceServer(
    new HTTPFacilitatorClient({ url: d.facilitatorUrl }),
  ).register(NETWORK, new MandateServerScheme());

  app.get("/answer", async (c, next) => {
    const filled = checkForm(d.form, c.req.query(), { coerce: true });
    if (!filled.ok) return c.json({ error: "bad_request", issues: filled.problems }, 400);
    const a = await d.answer(filled.values).catch(() => null);
    const ok = a && AnswerSchema.safeParse(a).success ? a : null;
    if (!ok)
      return c.json(
        { error: "not_found", message: "Nothing found for that: nothing was charged." },
        404,
      );
    found.set(c.req.raw, ok);
    await next();
  });
  app.use(
    paymentMiddleware(
      {
        "GET /answer": {
          accepts: { scheme: "exact", network: NETWORK, price: d.feeUsd, payTo: d.accountId },
          description: `${d.what} Paid per lookup.`,
        },
      },
      resource,
    ),
  );
  app.get("/answer", (c) => c.json({ answer: found.get(c.req.raw) }));
}
