import { arkivReader } from "@app/arkiv";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { claudeConcierge } from "./concierge/concierge";
import { arkivMarket } from "./concierge/market";
import { loadConfig } from "./config";
import { connectDb } from "./db/client";

const config = loadConfig();
const { db } = await connectDb(config.databaseUrl);
const concierge = claudeConcierge(arkivMarket(arkivReader()));
const app = createApp({ appOrigin: config.appOrigin, db, auth: config.auth, concierge });
serve({ fetch: app.fetch, port: config.port }, () =>
  console.log(`api on http://localhost:${config.port}`),
);
