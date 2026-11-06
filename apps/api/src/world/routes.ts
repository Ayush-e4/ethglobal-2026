import { Hono } from "hono";
import { currentUser } from "../auth/current";
import type { Db } from "../db/client";
import type { WalletService } from "../wallet/service";
import type { WorldBonus } from "./bonus";
import type { WorldCheck, WorldChecks } from "./checks";

const view = (c: WorldCheck) => ({
  id: c.id,
  status: c.status,
  reason: c.reason,
  userCode: c.userCode,
  link: c.link,
  expiresAt: new Date(c.expiresAt).toISOString(),
});

/**
 * GET /world: is this account a verified person (World ID), its welcome bonus, and its newest
 * bonus check. POST /world/bonus starts a check that sends the bonus once it passes. The
 * verdict is reached on the server; the browser only shows the code and asks how it's going.
 */
export function worldRoutes(
  db: Db,
  o: { checks: WorldChecks | null; bonus: WorldBonus; wallets: WalletService },
) {
  const app = new Hono();

  app.get("/world", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    if (!o.checks) return c.json({ available: false });
    const [bonus, check] = await Promise.all([
      o.bonus.get(user.id),
      o.checks.latest(user.id, "bonus"),
    ]);
    return c.json({
      available: true,
      verified: Boolean(user.worldSub),
      bonusUnits: o.bonus.units.toString(),
      bonus: bonus && { units: bonus.units.toString(), status: bonus.status, tx: bonus.tx },
      check: check && view(check),
    });
  });

  app.post("/world/bonus", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    if (!o.checks) return c.json({ error: "World ID isn't set up on this server" }, 503);
    if (user.isDemo)
      return c.json(
        { error: "The bonus goes to your own Face ID wallet: demo accounts have none" },
        409,
      );
    if (await o.bonus.get(user.id)) return c.json({ error: "You've had your bonus" }, 409);
    if ((await o.wallets.get(user.id, false))?.status !== "ready")
      return c.json({ error: "Your wallet isn't ready yet" }, 409);
    const latest = await o.checks.latest(user.id, "bonus");
    if (latest?.status === "waiting" && latest.expiresAt > Date.now())
      return c.json({ check: view(latest) }); // one at a time
    const check = await o.checks.start(user.id, "bonus").catch((err: Error) => err);
    if (check instanceof Error) return c.json({ error: check.message }, 502);
    return c.json({ check: view(check) }, 201);
  });

  return app;
}
