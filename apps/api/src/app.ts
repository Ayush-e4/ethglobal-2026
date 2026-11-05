import { Hono } from "hono";
import { cors } from "hono/cors";
import { type AuthConfig, authRoutes } from "./auth/routes";
import { chatRoutes } from "./chats/routes";
import type { Concierge } from "./concierge/concierge";
import type { Db } from "./db/client";

export type AppOptions = { appOrigin: string; db: Db; auth: AuthConfig; concierge: Concierge };

export function createApp({ appOrigin, db, auth, concierge }: AppOptions) {
  const app = new Hono();
  app.use("*", cors({ origin: appOrigin, credentials: true }));
  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/", authRoutes(db, auth));
  app.route("/", chatRoutes(db, concierge));
  return app;
}
