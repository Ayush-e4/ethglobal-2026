import type { Card } from "@app/shared";
import { and, desc, eq } from "drizzle-orm";
import { toHistory } from "../chats/history";
import { chatStore } from "../chats/store";
import type { Concierge } from "../concierge/concierge";
import type { Db } from "../db/client";
import { alertChannels, chats, messages, users } from "../db/schema";
import type { TravellerService } from "../travellers/service";
import type { WorldCheck } from "../world/checks";
import type { CallbackQuery } from "./live-hires";
import type { TelegramAlerts, TgPhotos } from "./telegram";
import { showSlide } from "./telegram-carousel";
import {
  cardMessages,
  carouselRef,
  chunks,
  draftText,
  esc,
  html,
  quoteButton,
} from "./telegram-format";
import { telegramLinks } from "./telegram-links";
import { telegramTravellers } from "./telegram-travellers";

export interface TelegramChatDeps {
  db: Db;
  t: TelegramAlerts;
  concierge: Concierge;
  appOrigin: string;
  /** Starts the World ID approval of a quote's agent and fee (approval-routes.ts). */
  approve?: (
    userId: string,
    chatId: string,
    quoteKey: string,
  ) => Promise<{ check: WorldCheck } | { error: string }>;
  check?: (id: string, userId: string) => Promise<WorldCheck | null>;
  travellers?: TravellerService; // who bookings are for
  wait?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The concierge in Telegram. A linked Telegram chat talks to one Shikigami chat (the same turns,
 * tools and payments as the web, saved in that chat; /new starts another). The reply streams in
 * as a draft ("Thinking…", then the text as it's written) and is then sent for good; offers come
 * as photos with Book buttons; a World ID approval opens from a button and, once it passes, the
 * booking carries on here. Spending limits need Face ID, so those point to the web.
 */
export function telegramChat(d: TelegramChatDeps) {
  const { db, t } = d;
  const store = chatStore(db);
  const wait = d.wait ?? sleep;
  const log = d.log ?? ((line: string) => console.error(line));
  const busy = new Set<string>();
  const say = (chatId: string, text: string, extra: Record<string, unknown> = {}) =>
    t.tg("sendMessage", { chat_id: chatId, text, ...extra }).catch(() => null);
  const people = telegramTravellers(t, d.travellers, say);

  const { link, chatFor } = telegramLinks(db, store);

  /** A World ID approval from Telegram: a button to World's page; once it passes, carry on. */
  async function human(
    tgChatId: string,
    userId: string,
    chatId: string,
    card: Extract<Card, { type: "human" }>,
  ) {
    const r = d.approve
      ? await d.approve(userId, chatId, card.quoteKey)
      : { error: "World ID isn't set up here" };
    if ("error" in r) return say(tgChatId, `Couldn't start World ID: ${r.error}.`);
    await say(
      tgChatId,
      `<b>Confirm it's you with World ID</b>\nThis booking puts ${(Number(card.feeUnits) / 1e6).toFixed(2)} USDC into escrow (${esc(card.agentName)}'s fee plus the trip price), a larger payment, so a real person approves it first. Code: <code>${esc(r.check.userCode)}</code>\n\nApprove in the World ID app, then come back to World's page: that finishes it.`,
      {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "Approve with World ID", url: r.check.link }]] },
      },
    );
    void (async () => {
      let c: WorldCheck | null = r.check;
      while (c?.status === "waiting" && c.expiresAt > Date.now()) {
        await wait(3000);
        c = (await d.check?.(c.id, userId)) ?? null;
      }
      if (c?.status === "verified") return turn(tgChatId, card.reply);
      await say(
        tgChatId,
        c?.status === "denied"
          ? "You declined in the World ID app. Nothing was paid."
          : "The World ID approval didn't go through. Nothing was paid.",
      );
    })().catch((err) => log(`telegram chat: ${String(err).slice(0, 120)}`));
  }

  /** One turn with the concierge, as if typed in the app's chat. */
  async function turn(tgChatId: string, text: string, photos?: TgPhotos): Promise<void> {
    if (busy.has(tgChatId)) {
      await say(tgChatId, "Still on your last message: one moment.");
      return;
    }
    busy.add(tgChatId);
    try {
      const l = await link(tgChatId);
      const [user] = l ? await db.select().from(users).where(eq(users.id, l.userId)) : [];
      if (!l || !user) {
        await say(tgChatId, "Connect this chat first: Shikigami → Settings → Phone alerts.");
        return;
      }
      // "Someone else": this message is the guest's details, so it never reaches the concierge.
      const guest = photos
        ? { handled: false as const }
        : await people.intercept(tgChatId, user.id, l.appChatId, text);
      if (guest.handled) {
        if (guest.carryOn) {
          busy.delete(tgChatId);
          await turn(tgChatId, guest.carryOn);
        }
        return;
      }
      const chat = await chatFor(user.id, l.appChatId, text || "A photo");
      const history = toHistory(await store.messages(chat.id));
      await store.add(
        chat.id,
        "user",
        text,
        photos ? [{ type: "photos", thumbs: photos.thumbs }] : [],
      );
      const draftId = 1 + Math.floor(Math.random() * 2 ** 30);
      const draft = (s: string) =>
        t
          .tg("sendMessageDraft", { chat_id: Number(tgChatId), draft_id: draftId, text: s })
          .catch(() => null);
      void draft(""); // "Thinking…"
      let written = "";
      let status = "";
      let last = 0;
      const push = (force = false) => {
        if (!force && Date.now() - last < 900) return;
        last = Date.now();
        void draft(written ? draftText(written) : `⏳ ${status}…`);
      };
      const reply = await d.concierge({
        context: { user, chatId: chat.id },
        history,
        text,
        images: photos?.images,
        emit: (e) => {
          if (e.type === "text") {
            written += e.delta;
            push();
          } else if (e.type === "status" && !written) {
            status = e.label;
            push(true);
          }
        },
      });
      await store.add(chat.id, "assistant", reply.text, reply.cards);
      const sayText = async () => {
        for (const part of chunks(html(reply.text)))
          await say(tgChatId, part, {
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
          });
      };
      // With offers, the hotels come first and the concierge's pick after them, to read on from.
      const offersFirst = reply.cards.some((c) => c.type === "quotes");
      if (!offersFirst) await sayText();
      const appLink = `${d.appOrigin}/chat/${chat.id}`;
      for (const card of reply.cards) {
        if (card.type === "human") await human(tgChatId, user.id, chat.id, card);
        else if (card.type === "traveller") await people.ask(tgChatId, user.id, card);
        else
          for (const m of cardMessages(card, appLink)) {
            const sent = await t.tg(m.method, { chat_id: tgChatId, ...m.body }).catch(() => null);
            if (!sent?.ok && m.method === "sendPhoto") {
              // A photo Telegram can't load: the same offer as text, with its buttons.
              const { photo: _, caption, ...rest } = m.body;
              await t
                .tg("sendMessage", { chat_id: tgChatId, ...rest, text: caption })
                .catch(() => null);
            }
          }
      }
      if (offersFirst) await sayText();
    } catch (err) {
      log(`telegram chat ${tgChatId}: ${String(err).slice(0, 160)}`);
      await say(tgChatId, "Sorry, something went wrong. Please try again.");
    } finally {
      busy.delete(tgChatId);
    }
  }

  /** The latest cards in the Telegram chat's Shikigami chat (what its buttons stand for). */
  async function recentCards(tgChatId: string): Promise<Card[]> {
    const l = await link(tgChatId);
    if (!l?.appChatId) return [];
    const rows = await db
      .select({ cards: messages.cards })
      .from(messages)
      .innerJoin(chats, eq(chats.id, messages.chatId))
      .where(
        and(
          eq(messages.chatId, l.appChatId),
          eq(chats.userId, l.userId),
          eq(messages.role, "assistant"),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(10);
    return rows.flatMap((r) => r.cards);
  }

  /** The reply a Book or choice button stands for. */
  async function buttonReply(tgChatId: string, data: string): Promise<string | null> {
    for (const c of await recentCards(tgChatId)) {
      if (c.type === "quotes") {
        const q = c.quotes.find((x) => quoteButton(x.key) === data);
        if (q) return q.reply;
      }
      if (c.type === "options" && data.startsWith("o:"))
        return c.options[Number(data.slice(2))]?.reply ?? null;
    }
    return null;
  }

  /** ◀ ▶ or 📷 on the offers carousel: the same message shows another hotel or photo. */
  async function turnCarousel(cq: CallbackQuery) {
    const ref = (cq.data ?? "").split(":")[1];
    const card = (await recentCards(String(cq.message?.chat.id ?? ""))).find(
      (c): c is Extract<Card, { type: "quotes" }> => c.type === "quotes" && carouselRef(c) === ref,
    );
    return card ? showSlide(t, card, cq) : false;
  }

  return {
    turn,

    /** "/new": the next message starts a new Shikigami chat. */
    async fresh(tgChatId: string) {
      people.forget(tgChatId);
      await db
        .update(alertChannels)
        .set({ appChatId: null })
        .where(eq(alertChannels.telegramChatId, tgChatId));
      await say(tgChatId, "New conversation: tell me what you need.");
    },

    /** A button under a reply: the carousel's ◀ ▶ 📷, or Book, or a choice. */
    async onCallback(cq: CallbackQuery) {
      const tgChatId = String(cq.message?.chat.id ?? "");
      if (cq.data?.startsWith("tv:")) {
        const l = await link(tgChatId);
        const card = (await recentCards(tgChatId)).find(
          (c): c is Extract<Card, { type: "traveller" }> => c.type === "traveller",
        );
        const carryOn = await people.pick(cq, tgChatId, l, card);
        if (carryOn) await turn(tgChatId, carryOn);
        return;
      }
      if (cq.data === "n" || cq.data?.startsWith("c:")) {
        const turned = cq.data !== "n" && (await turnCarousel(cq).catch(() => false));
        await t
          .tg("answerCallbackQuery", {
            callback_query_id: cq.id,
            ...(cq.data !== "n" && !turned
              ? { text: "Those offers have expired: ask again." }
              : {}),
          })
          .catch(() => null);
        return;
      }
      const reply = tgChatId ? await buttonReply(tgChatId, cq.data ?? "") : null;
      await t
        .tg("answerCallbackQuery", {
          callback_query_id: cq.id,
          text: reply ? "On it…" : "That choice has expired: ask again.",
        })
        .catch(() => null);
      if (reply) await turn(tgChatId, reply);
    },
  };
}

export type TelegramChat = ReturnType<typeof telegramChat>;
