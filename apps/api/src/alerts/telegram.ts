import { randomBytes } from "node:crypto";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import { alertChannels as table } from "../db/schema";

export interface Alert {
  title: string; // the chat it's about
  text: string;
  url?: string; // where to look: the chat
}

const code = () => randomBytes(12).toString("base64url");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Phone alerts in Telegram, from our bot (a token from @BotFather; off without one). A user links
 * their Telegram chat by tapping Start on a one-time link; from then on, news about their hires
 * goes there. Sending is best effort: the chat message is the record, the alert a nudge.
 */
export function telegramAlerts(db: Db, token: string | undefined, fetchImpl: typeof fetch = fetch) {
  const tg = (method: string, body: unknown) =>
    fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(40_000),
    }).then((r) => r.json() as Promise<{ ok: boolean; result?: unknown; description?: string }>);
  let botName: Promise<string | null> | null = null;
  const row = async (userId: string) =>
    (await db.select().from(table).where(eq(table.userId, userId)))[0] ?? null;

  return {
    on: Boolean(token),
    tg,

    /** The bot's @name, for the link (null when Telegram is off or unreachable). */
    botName() {
      if (!token) return Promise.resolve(null);
      botName ??= tg("getMe", {})
        .then((r) => (r.result as { username?: string } | undefined)?.username ?? null)
        .catch(() => {
          botName = null; // try again next time
          return null;
        });
      return botName;
    },

    async status(userId: string) {
      const r = await row(userId);
      return { available: Boolean(token), linked: Boolean(r?.telegramChatId) };
    },

    /** Sends to the user's linked chat; false if there's none (or Telegram said no). */
    async send(userId: string, a: Alert): Promise<boolean> {
      const r = await row(userId);
      if (!token || !r?.telegramChatId) return false;
      const sent = await tg("sendMessage", {
        chat_id: r.telegramChatId,
        text: `${a.title}\n\n${a.text}${a.url ? `\n\n${a.url}` : ""}`,
        disable_web_page_preview: true,
      }).catch(() => null);
      return Boolean(sent?.ok);
    },

    /** A one-time link to the bot; tapping Start there finishes it (`finishLink`). */
    async startLink(userId: string): Promise<string | null> {
      const name = await this.botName();
      if (!name) return null;
      const linkCode = code();
      await db
        .insert(table)
        .values({ userId, linkCode })
        .onConflictDoUpdate({ target: table.userId, set: { linkCode } });
      return `https://t.me/${name}?start=${linkCode}`;
    },

    /** The bot got "/start <code>": that code's account gets alerts in this Telegram chat. */
    async finishLink(linkCode: string, chatId: string): Promise<string | null> {
      const [mine] = await db.select().from(table).where(eq(table.linkCode, linkCode));
      if (!mine) return null;
      // One Telegram chat, one account: linking it here unlinks it from any other account.
      await db
        .update(table)
        .set({ telegramChatId: null })
        .where(and(eq(table.telegramChatId, chatId), ne(table.userId, mine.userId)));
      await db
        .update(table)
        .set({ telegramChatId: chatId, linkCode: null })
        .where(eq(table.userId, mine.userId));
      return mine.userId;
    },

    async unlink(userId: string) {
      await db
        .update(table)
        .set({ telegramChatId: null, linkCode: null })
        .where(eq(table.userId, userId));
    },

    /** Telegram "/stop": no more alerts to that chat, whoever linked it. */
    async unlinkChat(chatId: string) {
      await db
        .update(table)
        .set({ telegramChatId: null })
        .where(and(isNotNull(table.telegramChatId), eq(table.telegramChatId, chatId)));
    },
  };
}

export type TelegramAlerts = ReturnType<typeof telegramAlerts>;

interface Update {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
}

/** What the bot does with one message: link with "/start <code>", stop with "/stop". */
export async function handleUpdate(t: TelegramAlerts, u: Update) {
  const chatId = u.message?.chat.id;
  if (chatId === undefined) return;
  const text = u.message?.text?.trim() ?? "";
  const say = (reply: string) =>
    t.tg("sendMessage", { chat_id: chatId, text: reply }).catch(() => null);
  const start = /^\/start(?:\s+([A-Za-z0-9_-]{8,64}))?$/.exec(text);
  if (start?.[1]) {
    const linked = await t.finishLink(start[1], String(chatId));
    return say(
      linked
        ? "Connected: AgentNet will tell you here when an agent books, refunds, or finds your room cheaper. Send /stop to stop."
        : "That link has expired or was used already. Tap Connect Telegram in AgentNet again.",
    );
  }
  if (text === "/stop") {
    await t.unlinkChat(String(chatId));
    return say("Stopped: no more AgentNet alerts here.");
  }
  return say("This bot sends AgentNet alerts. Connect it in AgentNet: Wallet → Phone alerts.");
}

/**
 * Reads the bot's messages by long polling: no public address needed, so it works on a laptop
 * too. Only one server may read a bot's messages, so each deployment needs its own bot.
 */
export function startTelegramBot(t: TelegramAlerts, log: (line: string) => void) {
  if (!t.on) return () => {};
  let running = true;
  let offset = 0;
  void (async () => {
    while (running) {
      const r = await t
        .tg("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] })
        .catch(() => null);
      if (!r?.ok) {
        if (r?.description) log(`telegram: ${r.description.slice(0, 120)}`);
        await sleep(5000);
        continue;
      }
      for (const u of (r.result as Update[]) ?? []) {
        offset = u.update_id + 1;
        await handleUpdate(t, u).catch((err) => log(`telegram: ${String(err).slice(0, 120)}`));
      }
    }
  })();
  return () => {
    running = false;
  };
}
