import { randomBytes } from "node:crypto";
import type { ChatImage } from "@app/shared";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import { alertChannels as table } from "../db/schema";
import { HELP, setUpBotProfile } from "./commands";
import type { CallbackQuery } from "./live-hires";

export interface Alert {
  title?: string; // a heading, if any
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

  /** A photo someone sent: one for Claude to read (up to ~1600 px) and a small thumbnail. */
  const download = async (fileId: string) => {
    const f = await tg("getFile", { file_id: fileId });
    const path = (f.result as { file_path?: string } | undefined)?.file_path;
    if (!f.ok || !path) return null;
    const res = await fetchImpl(`https://api.telegram.org/file/bot${token}/${path}`, {
      signal: AbortSignal.timeout(30_000),
    });
    return res.ok ? Buffer.from(await res.arrayBuffer()).toString("base64") : null;
  };

  return {
    on: Boolean(token),
    tg,

    async photos(sizes: TgPhotoSize[]): Promise<TgPhotos | null> {
      if (!token || sizes.length === 0) return null;
      const side = (s: TgPhotoSize) => Math.max(s.width, s.height);
      const big = sizes.filter((s) => side(s) <= 1600).at(-1) ?? sizes[0];
      const small = [...sizes].sort((a, b) => Math.abs(side(a) - 320) - Math.abs(side(b) - 320))[0];
      if (!big || !small) return null;
      const [full, thumb] = await Promise.all([download(big.file_id), download(small.file_id)]);
      if (!full || !thumb) return null;
      return {
        images: [{ mediaType: "image/jpeg", data: full }],
        thumbs: [`data:image/jpeg;base64,${thumb}`],
      };
    },

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
        text: [a.title, a.text, a.url].filter(Boolean).join("\n\n").slice(0, 4000),
        link_preview_options: { is_disabled: true },
      }).catch((err) => ({ ok: false, description: String(err).slice(0, 120) }));
      if (!sent.ok)
        console.error(`telegram: alert not sent: ${sent.description ?? "no reason given"}`);
      return sent.ok;
    },

    /**
     * A short nudge with one button ("Open"), not a copy of anything. Telegram only takes public
     * https links on buttons, so on a local address the link goes in the text instead.
     */
    async nudge(userId: string, text: string, open: { label: string; url: string }) {
      const r = await row(userId);
      if (!token || !r?.telegramChatId) return false;
      const button = open.url.startsWith("https://");
      const sent = await tg("sendMessage", {
        chat_id: r.telegramChatId,
        text: button ? text : `${text}\n${open.url}`,
        link_preview_options: { is_disabled: true },
        ...(button
          ? { reply_markup: { inline_keyboard: [[{ text: open.label, url: open.url }]] } }
          : {}),
      }).catch((err) => ({ ok: false, description: String(err).slice(0, 120) }));
      if (!sent.ok)
        console.error(`telegram: nudge not sent: ${sent.description ?? "no reason given"}`);
      return sent.ok;
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

/** What the bot does besides linking: button taps, and (later) people's messages. */
export interface BotHandlers {
  onCallback?: (cq: CallbackQuery) => Promise<unknown>;
  status?: (chatId: string) => Promise<string>; // "/status"
  // A message to the concierge, with the photo it came with (already downloaded).
  onText?: (chatId: string, text: string, photos?: TgPhotos) => Promise<unknown>;
  onNew?: (chatId: string) => Promise<unknown>; // "/new"
}

export interface TgPhotoSize {
  file_id: string;
  width: number;
  height: number;
}
/** A photo from Telegram, ready for the concierge: the image and its thumbnail. */
export interface TgPhotos {
  images: ChatImage[];
  thumbs: string[];
}

export interface Update {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
    caption?: string; // a photo's words
    photo?: TgPhotoSize[]; // the same photo in sizes, smallest first
  };
  callback_query?: CallbackQuery;
}

/** What the bot does with one message: link with "/start <code>", stop with "/stop". */
export async function handleUpdate(t: TelegramAlerts, u: Update, h: BotHandlers = {}) {
  if (u.callback_query) {
    if (h.onCallback) return h.onCallback(u.callback_query);
    return t
      .tg("answerCallbackQuery", { callback_query_id: u.callback_query.id })
      .catch(() => null);
  }
  const chatId = u.message?.chat.id;
  if (chatId === undefined) return;
  const text = (u.message?.text ?? u.message?.caption ?? "").trim();
  const photo = u.message?.photo;
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
  if (text === "/start" || text === "/help") return say(HELP);
  if (text === "/status") return say(h.status ? await h.status(String(chatId)) : HELP);
  if (text === "/new" && h.onNew) return h.onNew(String(chatId));
  if (text === "/stop") {
    await t.unlinkChat(String(chatId));
    return say("Stopped: no more AgentNet alerts here.");
  }
  if (h.onText && (text || photo?.length) && !text.startsWith("/")) {
    // Not awaited: a turn can take a minute, and other people's messages shouldn't wait.
    void (async () => {
      const photos = photo?.length ? await t.photos(photo).catch(() => null) : undefined;
      if (photo?.length && !photos && !text)
        return say("Couldn't read that photo. Try sending it again.");
      await h.onText?.(String(chatId), text.slice(0, 4000), photos ?? undefined);
    })();
    return;
  }
  return say(HELP);
}

/**
 * Reads the bot's messages by long polling: no public address needed, so it works on a laptop
 * too. Only one server may read a bot's messages, so each deployment needs its own bot.
 */
export function startTelegramBot(
  t: TelegramAlerts,
  log: (line: string) => void,
  h: BotHandlers = {},
) {
  if (!t.on) return () => {};
  void setUpBotProfile(t);
  let running = true;
  let offset = 0;
  void (async () => {
    while (running) {
      const r = await t
        .tg("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] })
        .catch(() => null);
      if (!r?.ok) {
        if (r?.description) log(`telegram: ${r.description.slice(0, 120)}`);
        await sleep(5000);
        continue;
      }
      for (const u of (r.result as Update[]) ?? []) {
        offset = u.update_id + 1;
        await handleUpdate(t, u, h).catch((err) => log(`telegram: ${String(err).slice(0, 120)}`));
      }
    }
  })();
  return () => {
    running = false;
  };
}
