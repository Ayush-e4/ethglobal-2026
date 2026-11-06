import { Hono } from "hono";
import { currentUser } from "../auth/current";
import type { Db } from "../db/client";
import type { WalletService } from "./service";

/**
 * GET /wallet: a passkey account's Face ID wallet (and its USDC), made if it isn't yet. Demo
 * accounts have none: they spend from the shared demo wallet, with daily caps.
 */
export function walletRoutes(db: Db, wallets: WalletService) {
  const app = new Hono();
  app.get("/wallet", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    if (user.isDemo) return c.json({ demo: true, wallet: null });
    void wallets.ensure(user.id).catch(() => {}); // a no-op unless it's missing or was cut off
    return c.json({ demo: false, wallet: await wallets.get(user.id) });
  });
  return app;
}
