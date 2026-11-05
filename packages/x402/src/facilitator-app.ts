import type { x402Facilitator } from "@x402/core/facilitator";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { Hono } from "hono";

type Body = { paymentPayload: PaymentPayload; paymentRequirements: PaymentRequirements };

/** The facilitator's HTTP API, as the official HTTPFacilitatorClient calls it. */
export function facilitatorApp(f: x402Facilitator) {
  const app = new Hono();
  app.get("/supported", (c) => c.json(f.getSupported()));
  app.post("/verify", async (c) => {
    const b = await c.req.json<Body>();
    return c.json(await f.verify(b.paymentPayload, b.paymentRequirements));
  });
  app.post("/settle", async (c) => {
    const b = await c.req.json<Body>();
    return c.json(await f.settle(b.paymentPayload, b.paymentRequirements));
  });
  app.onError((err, c) => c.json({ error: "facilitator_error", message: err.message }, 500));
  return app;
}
