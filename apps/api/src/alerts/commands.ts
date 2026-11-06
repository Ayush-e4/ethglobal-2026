import { formatUsdc } from "@app/shared";
import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { alertChannels, type Hire, hires } from "../db/schema";
import type { TelegramAlerts } from "./telegram";

/** Telegram's command menu (the "/" button). */
export const COMMANDS = [
  { command: "new", description: "Start a new conversation" },
  { command: "status", description: "Your bookings and price watches" },
  { command: "help", description: "What this bot does" },
  { command: "stop", description: "Stop alerts here" },
];

export const HELP = [
  "AgentNet books hotels through AI agents from an open market. They're paid on Hedera only when the job is done, and you can undo for about a minute.",
  "",
  "Just type what you need (say, a hotel in Goa for two, 20 to 22 December) and the concierge answers here, as in the app. Each booking then shows up live: Undo while you can, the reference, the payment, PriceGuard's cheaper rebooks, and a rating (verified people only, with World ID).",
  "",
  "/new: start a new conversation",
  "/status: your bookings and price watches",
  "/stop: no more alerts here",
].join("\n");

/** What people see before tapping Start, and in the bot's profile. */
export async function setUpBotProfile(t: TelegramAlerts) {
  if (!t.on) return;
  await Promise.all([
    t.tg("setMyCommands", { commands: COMMANDS }),
    t.tg("setMyDescription", {
      description:
        "AgentNet's concierge books hotels through AI agents from an open market, paid on Hedera only when the job is done. Chat with it here, and see each booking live: undo it, see its reference, rate the agent. Connect it in AgentNet: Wallet → Phone alerts.",
    }),
    t.tg("setMyShortDescription", {
      short_description:
        "Your AgentNet bookings, live: undo, the booking reference, rate the agent.",
    }),
  ]).catch(() => {});
}

const STATUS: Record<Hire["status"], string> = {
  paying: "⏳ paying",
  held: "⏳ fee held, booking",
  delivered: "✅ booked",
  released: "✅ booked and paid",
  cancelled: "↩ undone",
  refunded: "⚠️ refunded",
  failed: "⚠️ didn't go through",
};

/** "/status": the linked account's latest hires, newest first, one line each. */
export async function statusText(db: Db, chatId: string): Promise<string> {
  const [link] = await db
    .select({ userId: alertChannels.userId })
    .from(alertChannels)
    .where(eq(alertChannels.telegramChatId, chatId));
  if (!link) return "This chat isn't connected. Connect it in AgentNet: Wallet → Phone alerts.";
  const rows = await db
    .select()
    .from(hires)
    .where(eq(hires.userId, link.userId))
    .orderBy(desc(hires.createdAt))
    .limit(8);
  if (rows.length === 0) return "No bookings yet. Ask the concierge in AgentNet for a hotel.";
  const watching = rows.filter((h) => h.watching).length;
  return [
    `Your latest bookings${watching ? ` (${watching} with the price watched)` : ""}:`,
    "",
    ...rows.map(
      (h) =>
        `• ${h.title} · ${h.agentName}, ${formatUsdc(h.feeUnits)} USDC: ${STATUS[h.status]}${h.bookingRef && h.status !== "cancelled" ? ` (ref ${h.bookingRef})` : ""}${h.watchNote ? `\n   📉 ${h.watchNote}` : ""}`,
    ),
  ].join("\n");
}
