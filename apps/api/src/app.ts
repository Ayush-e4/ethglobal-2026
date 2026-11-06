import { Hono } from "hono";
import { cors } from "hono/cors";
import { type AuthConfig, authRoutes } from "./auth/routes";
import { chatRoutes } from "./chats/routes";
import type { Concierge } from "./concierge/concierge";
import type { Db } from "./db/client";
import { hireRoutes } from "./hiring/routes";
import type { HiringService } from "./hiring/service";
import { walletRoutes } from "./wallet/routes";
import type { WalletService } from "./wallet/service";

export type AppOptions = {
  appOrigin: string;
  db: Db;
  auth: AuthConfig;
  concierge: Concierge;
  hiring?: HiringService;
  wallets?: WalletService;
};

export function createApp({ appOrigin, db, auth, concierge, hiring, wallets }: AppOptions) {
  const app = new Hono();
  app.use("*", cors({ origin: appOrigin, credentials: true }));
  app.get("/health", (c) => c.json({ ok: true }));
  const onSignUp = wallets ? (id: string) => void wallets.ensure(id).catch(() => {}) : undefined;
  app.route("/", authRoutes(db, auth, onSignUp));
  app.route("/", chatRoutes(db, concierge));
  if (hiring) app.route("/", hireRoutes(db, hiring));
  if (wallets) app.route("/", walletRoutes(db, wallets));
  return app;
}
