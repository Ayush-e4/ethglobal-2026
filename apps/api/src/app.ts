import { Hono } from "hono";
import { cors } from "hono/cors";
import { deviceRoutes } from "./account/devices";
import { emailRoutes } from "./account/email";
import { alertRoutes } from "./alerts/routes";
import type { TelegramAlerts } from "./alerts/telegram";
import { deviceLinks } from "./auth/device-links";
import { type AuthConfig, authRoutes } from "./auth/routes";
import { chatRoutes, type ReplyReady } from "./chats/routes";
import type { Concierge } from "./concierge/concierge";
import type { Market } from "./concierge/market";
import type { ToolDeps } from "./concierge/tools";
import type { Db } from "./db/client";
import { dealRoutes } from "./deals/routes";
import type { DealService } from "./deals/service";
import type { Email, TryEmail } from "./email/resend";
import { limitRoutes } from "./hiring/limit-routes";
import { hireRoutes } from "./hiring/routes";
import type { HiringService } from "./hiring/service";
import type { Erc8004Market } from "./market/identity";
import type { AgentReviewService } from "./market/reviews";
import { marketRoutes } from "./market/routes";
import { grantRoutes } from "./mcp/grants";
import { oauthRoutes } from "./mcp/oauth";
import { mcpRoutes } from "./mcp/routes";
import { travellerRoutes } from "./travellers/routes";
import type { TravellerService } from "./travellers/service";
import { tripRoutes } from "./trips/routes";
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
  travellers?: TravellerService; // saved travellers: who bookings are for
  tools?: ToolDeps; // the concierge's tools, also offered to connected apps over MCP
  market?: { market: Market; reviews: AgentReviewService; erc8004?: Erc8004Market }; // agent pages, listing
  onAppConnected?: (userId: string, app: string) => Promise<unknown>; // the security email
  deals?: DealService; // deal drops: one claim per person (World ID)
  email?: { available: boolean; tryEmail: TryEmail; test: (to: string) => Email }; // account email
  replyReady?: ReplyReady; // a slow reply finished after its reader left: nudge them
  replyReadyAfterMs?: number; // how long a reply must take to be worth it (tests: 0)
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
  app.route("/", chatRoutes(db, concierge, o.replyReady, o.replyReadyAfterMs));
  if (hiring) app.route("/", hireRoutes(db, hiring, o.demoToken));
  if (hiring) app.route("/", tripRoutes(db, hiring));
  if (o.market) app.route("/", marketRoutes(db, o.market));
  if (o.deals) app.route("/", dealRoutes(db, o.deals));
  if (o.email) app.route("/", emailRoutes(db, o.email));
  // Connected apps (Claude): OAuth to connect, and the concierge's tools over MCP.
  app.route("/", oauthRoutes(db, appOrigin, o.onAppConnected));
  app.route("/", grantRoutes(db));
  if (hiring && o.tools) app.route("/", mcpRoutes(db, appOrigin, { tools: o.tools, hiring }));
  if (o.alerts) app.route("/", alertRoutes(db, o.alerts));
  if (o.travellers) app.route("/", travellerRoutes(db, o.travellers));
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
