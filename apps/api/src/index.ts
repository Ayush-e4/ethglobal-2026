import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { connectDb } from "./db/client";

const config = loadConfig();
const { db } = await connectDb(config.databaseUrl);
const app = createApp({ appOrigin: config.appOrigin, db, auth: config.auth });
serve({ fetch: app.fetch, port: config.port }, () =>
  console.log(`api on http://localhost:${config.port}`),
);
