import { rateAgent, SafeArkivWriter } from "@app/arkiv";
import { serve } from "@hono/node-server";
import { statusText } from "./alerts/commands";
import { liveHires } from "./alerts/live-hires";
import { alertingChats } from "./alerts/routes";
import { startTelegramBot, telegramAlerts } from "./alerts/telegram";
import { telegramChat } from "./alerts/telegram-chat";
import { createApp } from "./app";
import { chatStore } from "./chats/store";
import { claudeConcierge } from "./concierge/concierge";
import { saveQuotes } from "./concierge/quote-store";
import type { ToolDeps } from "./concierge/tools";
import { loadConfig } from "./config";
import { connectDb } from "./db/client";
import { loadIdkitConfig } from "./deals/idkit";
import { dealService } from "./deals/service";
import { confirmations } from "./email/confirmations";
import { resendEmail } from "./email/resend";
import { loadHiringConfig } from "./hiring/config";
import { arkivDisputes } from "./hiring/dispute-record";
import { reportedNote } from "./hiring/disputes";
import { hireFollower } from "./hiring/follow";
import { hiringService } from "./hiring/service";
import { marketplace } from "./market/setup";
import { travellerService } from "./travellers/service";
import { hederaWalletChain } from "./wallet/chain";
import { loadWalletConfig } from "./wallet/config";
import { walletApprovals } from "./wallet/ops";
import { walletService } from "./wallet/service";
import { startSpendApproval } from "./world/approval-routes";
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
// Saved travellers: who each booking is for (private; sent only to the agent hired).
const travellers = travellerService(db);
// Reported problems, on the public record (Arkiv): the market counts them per agent.
const disputes = arkivDisputes(db, platform);
// The market, gated by our review of each agent (checked again hourly, and after a report).
const { market, reviews } = marketplace(db, platform, config.appOrigin);
const hiring = hiringService(db, loadHiringConfig(), (id) => wallets.get(id, false), {
  guest: travellers.gate(),
  human: checks ? humanCheckpoint(checks, minFeeUnits) : undefined,
  async onDispute(hire, reason, outcome) {
    await disputes.onDispute(hire, reason, outcome);
    void reviews.onDispute(hire.quoteKey).catch(() => {});
  },
});
// Phone alerts in Telegram (our own bot; off without TELEGRAM_BOT_TOKEN): each hire is one live
// message there, with Undo and ratings, and the chats' own news buzzes as alerts.
const alerts = telegramAlerts(db, process.env.TELEGRAM_BOT_TOKEN || undefined);
const live = liveHires({
  db,
  t: alerts,
  appOrigin: config.appOrigin,
  cancel: (user, chatId, hireId) => hiring.cancel(user, chatId, hireId),
  async dispute(user, chatId, hireId, reason) {
    const h = await hiring.dispute(user, chatId, hireId, reason);
    await chatStore(db).add(chatId, "assistant", reportedNote(h, reason));
  },
  ratings,
});
// Emails (Resend; off without RESEND_API_KEY): the guest's confirmations, and account notices.
const confirm = confirmations(
  resendEmail(process.env.RESEND_API_KEY, process.env.RESEND_FROM),
  config.appOrigin,
);
// Deal drops: one claim per person (World ID through IDKit), paying back a booking's fee.
const deals = dealService(db, {
  idkit: loadIdkitConfig(),
  wallets,
  chain: walletChain,
  chats: chatStore(db),
});
const hiringLive = {
  ...hiring,
  async cancel(...a: Parameters<typeof hiring.cancel>) {
    const h = await hiring.cancel(...a);
    void live.show(h.id);
    return h;
  },
  async cancelBooking(...a: Parameters<typeof hiring.cancelBooking>) {
    const h = await hiring.cancelBooking(...a);
    void confirm.cancelled(h).catch(() => {});
    return h;
  },
};
// The market, quotes and hiring: the concierge's tools, also offered to connected apps (MCP).
const tools: ToolDeps = {
  market,
  saveQuotes: (chatId, shown) => saveQuotes(db, chatId, shown),
  async hire(user, chatId, quoteKey) {
    const h = await hiring.hire(user, chatId, quoteKey);
    void live.show(h.id);
    return h;
  },
};
const concierge = claudeConcierge(tools);
// The concierge in Telegram too: the same turns as the web, in the same chats.
const tgChat = telegramChat({
  db,
  t: alerts,
  concierge,
  appOrigin: config.appOrigin,
  approve: checks
    ? (userId, chatId, quoteKey) =>
        startSpendApproval(db, checks, minFeeUnits, userId, chatId, quoteKey)
    : undefined,
  check: checks ? (id, userId) => checks.get(id, userId) : undefined,
  travellers,
});
startTelegramBot(alerts, (line) => console.error(line), {
  // Book, choices and the offers carousel go to the chat; Undo and ratings to the hire's message.
  onCallback: (cq) =>
    /^([boc]:|tv:|n$)/.test(cq.data ?? "") ? tgChat.onCallback(cq) : live.onCallback(cq),
  status: (chatId) => statusText(db, chatId),
  onText: tgChat.turn,
  onNew: tgChat.fresh,
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
  travellers,
  alerts,
  tools,
  market: { market, reviews },
  deals,
  // An app (Claude) was connected: tell the account's own traveller ("me"), if it has one.
  async onAppConnected(userId, app) {
    const me = (await travellers.list(userId)).find((t) => t.isSelf);
    if (me) await confirm.connected(me.email, me.firstName, app);
  },
});
reviews.start(); // our own agents first, then every approved agent hourly
await checks?.resume(); // World ID checks a restart interrupted
// Follows every open hire to the end, from the database: restarts lose nothing.
await hireFollower(
  db,
  hiring.registry,
  alertingChats(db, chatStore(db), alerts, config.appOrigin),
  5000,
  {
    onChange: live.show,
    onBooked: confirm.booked,
    onRebooked: confirm.rebooked,
    onRefunded: confirm.refunded,
    onReleased: deals.onReleased,
    onDisputeSettled: disputes.onSettled,
  },
).start();
serve({ fetch: app.fetch, port: config.port }, () =>
  console.log(`api on http://localhost:${config.port}`),
);
