import { arkivReader, rateAgent, SafeArkivWriter } from "@app/arkiv";
import { serve } from "@hono/node-server";
import { liveHires } from "./alerts/live-hires";
import { alertingChats } from "./alerts/routes";
import { startTelegramBot, telegramAlerts } from "./alerts/telegram";
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
import { humanCheckpoint, loadCheckpointOptions } from "./world/checkpoint";
import { worldChecks } from "./world/checks";
import { loadWorldConfig, worldClient } from "./world/oidc";
import { onWorldVerified } from "./world/on-verified";
import { worldRatings } from "./world/ratings";

const config = loadConfig();
const { db } = await connectDb(config.databaseUrl);
const walletCfg = loadWalletConfig();
const walletChain = hederaWalletChain(walletCfg);
const wallets = walletService(db, walletChain, walletCfg);
const approvals = walletApprovals(db, walletChain, config.auth.site);
// World ID: a person who proves they're one gets a welcome bonus, once per World ID, and
// approves larger hires (from WORLD_CHECK_FEE_USDC) in the World ID app.
const worldCfg = loadWorldConfig();
const bonus = worldBonus(db, walletChain, wallets, loadBonusOptions());
// Verified people's ratings, posted to Arkiv by our own writer (the only ratings readers trust).
const arkivKey = process.env.ARKIV_WRITER_PRIVATE_KEY as `0x${string}` | undefined;
const platform = arkivKey ? new SafeArkivWriter(arkivKey) : null;
const ratings = process.env.RATINGS_SECRET
  ? worldRatings(db, {
      secret: process.env.RATINGS_SECRET,
      post: platform ? (r) => rateAgent(platform, r) : null,
    })
  : null;
const checks = worldCfg
  ? worldChecks(db, worldClient(worldCfg), onWorldVerified({ bonus, ratings }))
  : null;
const { minFeeUnits } = loadCheckpointOptions();
// Passkey accounts pay from their own Face ID wallet; demo accounts from the demo wallet.
const hiring = hiringService(
  db,
  loadHiringConfig(),
  (id) => wallets.get(id, false),
  checks ? humanCheckpoint(checks, minFeeUnits) : undefined,
);
// Phone alerts in Telegram (our own bot; off without TELEGRAM_BOT_TOKEN): each hire is one live
// message there, with Undo and ratings, and the chats' own news buzzes as alerts.
const alerts = telegramAlerts(db, process.env.TELEGRAM_BOT_TOKEN || undefined);
const live = liveHires({
  db,
  t: alerts,
  appOrigin: config.appOrigin,
  cancel: (user, chatId, hireId) => hiring.cancel(user, chatId, hireId),
  ratings,
});
startTelegramBot(alerts, (line) => console.error(line), { onCallback: live.onCallback });
const hiringLive = {
  ...hiring,
  async cancel(...a: Parameters<typeof hiring.cancel>) {
    const h = await hiring.cancel(...a);
    void live.show(h.id);
    return h;
  },
};
const concierge = claudeConcierge({
  market: arkivMarket(arkivReader(), fetch, platform?.address),
  saveQuotes: (chatId, shown) => saveQuotes(db, chatId, shown),
  async hire(user, chatId, quoteKey) {
    const h = await hiring.hire(user, chatId, quoteKey);
    void live.show(h.id);
    return h;
  },
});
const app = createApp({
  appOrigin: config.appOrigin,
  db,
  auth: config.auth,
  concierge,
  hiring: hiringLive, // undo from the web also updates the Telegram message
  wallets,
  walletChain,
  approvals,
  demoToken: process.env.DEMO_TOKEN || undefined,
  world: { checks, bonus, minFeeUnits, ratings },
  alerts,
});
await checks?.resume(); // World ID checks a restart interrupted
// Follows every open hire to the end, from the database: restarts lose nothing.
await hireFollower(
  db,
  hiring.registry,
  alertingChats(db, chatStore(db), alerts, config.appOrigin),
  5000,
  live.show,
).start();
serve({ fetch: app.fetch, port: config.port }, () =>
  console.log(`api on http://localhost:${config.port}`),
);
