import { Hono } from "hono";
import { cors } from "hono/cors";
import { deviceRoutes } from "./account/devices";
import { alertRoutes } from "./alerts/routes";
import type { TelegramAlerts } from "./alerts/telegram";
import { deviceLinks } from "./auth/device-links";
import { type AuthConfig, authRoutes } from "./auth/routes";
import { chatRoutes } from "./chats/routes";
import type { Concierge } from "./concierge/concierge";
import type { Db } from "./db/client";
import { limitRoutes } from "./hiring/limit-routes";
import { hireRoutes } from "./hiring/routes";
import type { HiringService } from "./hiring/service";
import type { WalletChain } from "./wallet/chain";
import { walletLimitRoutes } from "./wallet/limits-routes";
import type { WalletApprovals } from "./wallet/ops";
import { walletRoutes } from "./wallet/routes";
import type { WalletService } from "./wallet/service";
import { approvalRoutes } from "./world/approval-routes";
import type { WorldBonus } from "./world/bonus";
import type { WorldChecks } from "./world/checks";
import { ratingRoutes } from "./world/rating-routes";
import type { WorldRatings } from "./world/ratings";
import { worldRoutes } from "./world/routes";

export type AppOptions = {
  appOrigin: string;
  db: Db;
  auth: AuthConfig;
  concierge: Concierge;
  hiring?: HiringService;
  wallets?: WalletService;
  walletChain?: WalletChain; // with `approvals`: Face ID approvals of spending limits
  approvals?: WalletApprovals;
  demoToken?: string; // enables the "simulate a price drop" demo control
  alerts?: TelegramAlerts; // phone alerts in Telegram
  // World ID: "prove you're a person", for the bonus and to approve hires from `minFeeUnits`
  world?: {
    checks: WorldChecks | null;
    bonus: WorldBonus;
    minFeeUnits: bigint;
    ratings?: WorldRatings | null; // verified people's ratings of agents, posted to Arkiv
  };
};

export function createApp(o: AppOptions) {
  const { appOrigin, db, auth, concierge, hiring, wallets } = o;
  const app = new Hono();
  app.use("*", cors({ origin: appOrigin, credentials: true }));
  app.get("/health", (c) => c.json({ ok: true }));
  const onSignUp = wallets ? (id: string) => void wallets.ensure(id).catch(() => {}) : undefined;
  const links = deviceLinks(); // "use this account on another device" codes
  app.route("/", authRoutes(db, auth, onSignUp, links));
  app.route("/", chatRoutes(db, concierge));
  if (hiring) app.route("/", hireRoutes(db, hiring, o.demoToken));
  if (o.alerts) app.route("/", alertRoutes(db, o.alerts));
  if (wallets) app.route("/", walletRoutes(db, wallets));
  if (wallets && o.world) app.route("/", worldRoutes(db, { ...o.world, wallets }));
  if (o.world) app.route("/", approvalRoutes(db, o.world.checks, o.world.minFeeUnits));
  if (o.world?.ratings) app.route("/", ratingRoutes(db, o.world.ratings, o.world.checks));
  if (wallets && o.approvals)
    app.route("/", deviceRoutes(db, { wallets, approvals: o.approvals, links }));
  if (hiring && wallets && o.walletChain && o.approvals) {
    app.route("/", limitRoutes(db, hiring, wallets, o.walletChain, o.approvals));
    const registry = hiring.registry;
    app.route("/", walletLimitRoutes(db, { wallets, approvals: o.approvals, registry }));
  }
  return app;
}
