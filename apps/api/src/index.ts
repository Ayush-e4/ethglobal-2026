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
import { hederaWalletChain } from "./wallet/chain";
import { loadWalletConfig } from "./wallet/config";
import { walletApprovals } from "./wallet/ops";
import { walletService } from "./wallet/service";
import { loadBonusOptions, worldBonus } from "./world/bonus";
import { worldChecks } from "./world/checks";
import { loadWorldConfig, worldClient } from "./world/oidc";

const config = loadConfig();
const { db } = await connectDb(config.databaseUrl);
const walletCfg = loadWalletConfig();
const walletChain = hederaWalletChain(walletCfg);
const wallets = walletService(db, walletChain, walletCfg);
const approvals = walletApprovals(db, walletChain, config.auth.site);
// World ID: a person who proves they're one gets a welcome bonus, once per World ID.
const worldCfg = loadWorldConfig();
const bonus = worldBonus(db, walletChain, wallets, loadBonusOptions());
const checks = worldCfg
  ? worldChecks(db, worldClient(worldCfg), (c, v) => bonus.give(c.userId, v))
  : null;
// Passkey accounts pay from their own Face ID wallet; demo accounts from the demo wallet.
const hiring = hiringService(db, loadHiringConfig(), (id) => wallets.get(id, false));
const concierge = claudeConcierge({
  market: arkivMarket(arkivReader()),
  saveQuotes: (chatId, shown) => saveQuotes(db, chatId, shown),
  hire: (user, chatId, quoteKey) => hiring.hire(user, chatId, quoteKey),
});
const app = createApp({
  appOrigin: config.appOrigin,
  db,
  auth: config.auth,
  concierge,
  hiring,
  wallets,
  walletChain,
  approvals,
  demoToken: process.env.DEMO_TOKEN || undefined,
  world: { checks, bonus },
});
await checks?.resume(); // World ID checks a restart interrupted
// Follows every open hire to the end, from the database: restarts lose nothing.
await hireFollower(db, hiring.registry, chatStore(db)).start();
serve({ fetch: app.fetch, port: config.port }, () =>
  console.log(`api on http://localhost:${config.port}`),
);
