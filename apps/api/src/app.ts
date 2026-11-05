import { Hono } from "hono";
import { cors } from "hono/cors";

export type AppOptions = { appOrigin: string };

export function createApp({ appOrigin }: AppOptions) {
  const app = new Hono();
  app.use("*", cors({ origin: appOrigin, credentials: true }));
  app.get("/health", (c) => c.json({ ok: true }));
  return app;
}
