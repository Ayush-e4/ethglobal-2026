import type { Card } from "@app/shared";
import type { TelegramAlerts } from "./telegram";
import { cardMessages, chunks, html } from "./telegram-format";

type Reply = { text: string; cards: Card[] };
type Say = (chatId: string, text: string, extra?: Record<string, unknown>) => Promise<unknown>;

/** Cards that ask the person to do something (approve, say who it's for). */
export const ACTION_CARDS = new Set<Card["type"]>(["limit", "human", "traveller"]);

/**
 * A concierge reply as Telegram messages: its text, and its cards the way the app shows them.
 * With offers, the hotels come first and the concierge's pick after them, to read on from.
 * `act` handles World ID and "who is it for" here; a photo Telegram can't load goes as text.
 */
export async function deliverReply(
  t: TelegramAlerts,
  say: Say,
  tgChatId: string,
  reply: Reply,
  appLink: string,
  act?: (card: Card) => Promise<unknown>,
) {
  const sayText = async () => {
    if (!reply.text.trim()) return;
    for (const part of chunks(html(reply.text)))
      await say(tgChatId, part, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
  };
  const offersFirst = reply.cards.some((c) => c.type === "quotes");
  if (!offersFirst) await sayText();
  for (const card of reply.cards) {
    if (card.type === "human" || card.type === "traveller") {
      await act?.(card);
      continue;
    }
    for (const m of cardMessages(card, appLink)) {
      const sent = await t.tg(m.method, { chat_id: tgChatId, ...m.body }).catch(() => null);
      if (!sent?.ok && m.method === "sendPhoto") {
        const { photo: _, caption, ...rest } = m.body;
        await t.tg("sendMessage", { chat_id: tgChatId, ...rest, text: caption }).catch(() => null);
      }
    }
  }
  if (offersFirst) await sayText();
}
