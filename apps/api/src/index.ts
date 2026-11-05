import { arkivReader } from "@app/arkiv";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { chatStore } from "./chats/store";
import { claudeConcierge } from "./concierge/concierge";
import { arkivMarket } from "./concierge/market";
import { saveQuotes } from "./concierge/quote-store";
import { loadConfig } from "./config";
import { connectDb } from "./db/client";
import { loadHiringConfig } from "./hiring/config";
import { hireFollower } from "./hiring/follow";
import { hiringService } from "./hiring/service";

const config = loadConfig();
const { db } = await connectDb(config.databaseUrl);
const hiring = hiringService(db, loadHiringConfig());
const concierge = claudeConcierge({
  market: arkivMarket(arkivReader()),
  saveQuotes: (chatId, shown) => saveQuotes(db, chatId, shown),
  hire: (user, chatId, quoteKey) => hiring.hire(user, chatId, quoteKey),
});
const app = createApp({ appOrigin: config.appOrigin, db, auth: config.auth, concierge, hiring });
// Follows every open hire to the end, from the database: restarts lose nothing.
await hireFollower(db, hiring.registry, chatStore(db)).start();
serve({ fetch: app.fetch, port: config.port }, () =>
  console.log(`api on http://localhost:${config.port}`),
);
