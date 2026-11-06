import { Hono } from "hono";
import { z } from "zod";
import { currentUser } from "../auth/current";
import type { Db } from "../db/client";
import { HireError } from "../hiring/errors";
import { NeedsLimit } from "../hiring/limits";
import type { HiringService } from "../hiring/service";
import type { WalletService } from "../wallet/service";
import { merchantService } from "./merchants";

const Frame = z.string().regex(/^[0-9a-fA-F]{48}$/); // 24 bytes
const Live = z.string().regex(/^[0-9a-fA-F]{16}$/); // 8 bytes
const Check = z.object({ frame: Frame, live: Live.optional() });
const Pay = Check.extend({ how: z.enum(["qr", "sound"]) });

/**
 * Paying in person. A merchant: GET/POST /merchant (get paid, under a name), POST
 * /merchant/requests { inr } (a signed request, for a Live QR or a chirp), GET
 * /merchant/requests/:id (paid yet?). A payer: POST /pay/check { frame, live? } (who and how
 * much, before paying), POST /pay { frame, live?, how }.
 */
export function inPersonRoutes(db: Db, hiring: HiringService, wallets: WalletService) {
  const app = new Hono();
  const merchants = merchantService(db, (id) => wallets.get(id, false));
  const refuse = (err: unknown) => {
    if (err instanceof HireError) return { error: "refused", message: err.message };
    throw err;
  };

  app.get("/merchant", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    return c.json({ merchant: await merchants.get(user) });
  });
  app.post("/merchant", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const b = z
      .object({ name: z.string().trim().min(2).max(40) })
      .safeParse(await c.req.json().catch(() => null));
    if (!b.success)
      return c.json({ error: "bad_request", message: "Give a name of 2–40 letters." }, 400);
    try {
      return c.json({ merchant: await merchants.become(user, b.data.name) });
    } catch (err) {
      return c.json(refuse(err), 409);
    }
  });
  app.post("/merchant/requests", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const b = z.object({ inr: z.number().int() }).safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: "bad_request" }, 400);
    try {
      return c.json(await merchants.request(user, b.data.inr), 201);
    } catch (err) {
      return c.json(refuse(err), 409);
    }
  });
  app.get("/merchant/requests/:id", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const id = z.uuid().safeParse(c.req.param("id"));
    const s = id.success ? await merchants.status(user, id.data) : null;
    return s ? c.json(s) : c.json({ error: "not_found" }, 404);
  });

  app.post("/pay/check", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const b = Check.safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: "bad_request" }, 400);
    try {
      return c.json(await hiring.inPerson.check(b.data.frame.toLowerCase(), b.data.live));
    } catch (err) {
      return c.json(refuse(err), 409);
    }
  });
  app.post("/pay", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const b = Pay.safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: "bad_request" }, 400);
    try {
      return c.json(
        await hiring.inPerson.pay(user, b.data.frame.toLowerCase(), {
          live: b.data.live,
          how: b.data.how,
        }),
      );
    } catch (err) {
      if (err instanceof NeedsLimit) {
        const chat = await hiring.inPerson.payerChat(user.id);
        return c.json({ error: "needs_limit", card: err.card, chatId: chat.id }, 409);
      }
      return c.json(refuse(err), 409);
    }
  });
  return app;
}
