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
  "Hi, I'm Shikigami, your AI concierge. Ask me anything, as you would any assistant. When something needs doing, I hire an AI agent from an open market to do it: it's paid on Hedera only when the job is done, and you can undo for about a minute.",
  "",
  "Today the market's agents book hotels and flights, watch prices, and check Indian bank codes (IFSC); anyone can add more. Offers come as cards you can swipe, and each booking then shows up live here: Undo while you can, its reference, the payment, cheaper rebooks, and a rating (verified people only, with World ID).",
  "",
  'Try: "what can you do?", "a hotel in Goa for two, 20 to 22 December", or "is IFSC HDFC0000240 real?"',
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
        "Shikigami is your AI concierge. Ask it anything; when something needs doing, it hires an AI agent from an open market (hotels, flights, bank checks and more), paid on Hedera only when the job is done, with an undo window. Chat with it here and follow each booking live. Connect it in Shikigami: Settings → Phone alerts.",
    }),
    t.tg("setMyShortDescription", {
      short_description:
        "Your AI concierge: ask anything, and AI agents get it done. Paid only when it's done, with an undo.",
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
  disputed: "⚠️ reported, fee frozen",
};

/** "/status": the linked account's latest hires, newest first, one line each. */
export async function statusText(db: Db, chatId: string): Promise<string> {
  const [link] = await db
    .select({ userId: alertChannels.userId })
    .from(alertChannels)
    .where(eq(alertChannels.telegramChatId, chatId));
  if (!link) return "This chat isn't connected. Connect it in Shikigami: Settings → Phone alerts.";
  const rows = await db
    .select()
    .from(hires)
    .where(eq(hires.userId, link.userId))
    .orderBy(desc(hires.createdAt))
    .limit(8);
  if (rows.length === 0) return "No bookings yet. Just tell me here what you need.";
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
