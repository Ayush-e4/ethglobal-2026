import { addKeyCalls, removeKeyCalls } from "@app/mandates";
import { and, asc, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { Address } from "viem";
import { z } from "zod";
import { currentUser } from "../auth/current";
import type { DeviceLinks } from "../auth/device-links";
import { endOtherSessions, endSession, SESSION_COOKIE } from "../auth/session";
import type { Db } from "../db/client";
import { passkeys } from "../db/schema";
import { ApprovalSchema, type WalletApprovals, WalletOpError } from "../wallet/ops";
import { passkeyKey, type WalletService } from "../wallet/service";

const Action = z.object({ action: z.enum(["add", "remove"]) });
const Run = z.object({ opId: z.uuid(), response: ApprovalSchema });

/**
 * Your devices: the passkeys on your account, and which of them may approve the wallet's moves.
 * Adding one: a code for the new device (it makes its own passkey and is signed in), then Face
 * ID on a device the wallet trusts lets it approve too. Removing one (a lost phone): Face ID
 * shuts it out of the wallet, its passkey stops signing in, and other sessions end.
 */
export function deviceRoutes(
  db: Db,
  d: { wallets: WalletService; approvals: WalletApprovals; links: DeviceLinks },
) {
  const app = new Hono();
  const keysOf = (userId: string) =>
    db.select().from(passkeys).where(eq(passkeys.userId, userId)).orderBy(asc(passkeys.createdAt));
  /**
   * Forgets a passkey and signs out where it might still be signed in: a device removing itself
   * signs out only here; removing another device signs out everywhere but here.
   */
  const forget = async (c: Context, userId: string, id: string, itself = false) => {
    await db.delete(passkeys).where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)));
    const token = getCookie(c, SESSION_COOKIE);
    if (itself) await endSession(db, token);
    else await endOtherSessions(db, userId, token);
  };
  const signedIn = async (c: Context) => {
    const user = await currentUser(db, c);
    return user && !user.isDemo ? user : null;
  };

  app.get("/account/devices", async (c) => {
    const user = await signedIn(c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    return c.json(
      (await keysOf(user.id)).map((k) => ({
        id: k.id,
        label: k.label,
        addedAt: k.createdAt.toISOString(),
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        onWallet: k.onWallet,
      })),
    );
  });

  app.post("/account/devices/link", async (c) => {
    const user = await signedIn(c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    return c.json(d.links.make(user.id));
  });

  /** Face ID, step 1: the batch that lets a device approve payments, or shuts it out. */
  app.post("/account/devices/:id/wallet/face-id", async (c) => {
    const user = await signedIn(c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const body = Action.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const keys = await keysOf(user.id);
    const key = keys.find((k) => k.id === c.req.param("id"));
    if (!key) return c.json({ error: "not_found" }, 404);
    const add = body.data.action === "add";
    const no = (message: string) => c.json({ error: "cannot", message }, 409);
    if (key.onWallet === add)
      return no(add ? "It can already approve." : "It can't approve anyway.");
    if (!add && keys.filter((k) => k.onWallet).length < 2)
      return no("It's the only device that can approve payments. Add another first.");
    const w = await d.wallets.get(user.id, false);
    if (w?.status !== "ready") return no("Your wallet isn't ready yet.");
    const k = passkeyKey(key.publicKey);
    const wallet = w.address as Address;
    try {
      return c.json(
        await d.approvals.prepare(
          user.id,
          add ? addKeyCalls(wallet, k) : removeKeyCalls(wallet, k),
          {
            kind: "device",
            passkeyId: key.id,
            add,
          },
        ),
      );
    } catch (err) {
      if (err instanceof WalletOpError) return no(err.message);
      throw err;
    }
  });

  /** Step 2: a trusted device signed it; the wallet runs it on Hedera; note who may approve now. */
  app.post("/account/devices/:id/wallet", async (c) => {
    const user = await signedIn(c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const body = Run.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const meta = await d.approvals.meta(user.id, body.data.opId);
    if (meta?.kind !== "device" || meta.passkeyId !== c.req.param("id"))
      return c.json({ error: "cannot", message: "That approval is for something else." }, 409);
    try {
      const run = await d.approvals.run(user.id, body.data.opId, body.data.response);
      if (meta.add)
        await db
          .update(passkeys)
          .set({ onWallet: true })
          .where(and(eq(passkeys.id, meta.passkeyId), eq(passkeys.userId, user.id)));
      else await forget(c, user.id, meta.passkeyId, run.approvedBy === meta.passkeyId);
      return c.json({ ok: true, tx: run.hash });
    } catch (err) {
      if (err instanceof WalletOpError)
        return c.json({ error: "cannot", message: err.message }, 409);
      console.error(`device ${meta.passkeyId}: ${err instanceof Error ? err.message : err}`);
      return c.json({ error: "failed", message: "Hedera didn't take it. Try again." }, 502);
    }
  });

  /** A device the wallet doesn't trust (nothing on Hedera to undo): just forget its passkey. */
  app.delete("/account/devices/:id", async (c) => {
    const user = await signedIn(c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const keys = await keysOf(user.id);
    const key = keys.find((k) => k.id === c.req.param("id"));
    if (!key) return c.json({ error: "not_found" }, 404);
    const no = (message: string) => c.json({ error: "cannot", message }, 409);
    if (key.onWallet) return no("It can approve payments: shut it out with Face ID instead.");
    if (keys.length < 2) return no("That's your only passkey.");
    await forget(c, user.id, key.id);
    return c.json({ ok: true });
  });
  return app;
}
