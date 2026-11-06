import type { Card } from "@app/shared";
import type { CallbackQuery } from "./live-hires";
import type { TelegramAlerts } from "./telegram";
import { slide } from "./telegram-format";

/**
 * Turns the offers carousel in place: hotel `h`, photo `p` from the button's data. A photo
 * message gets the new photo (or, for a hotel without photos, the new caption); a text one, the
 * new text. False if Telegram refused it.
 */
export async function showSlide(
  t: TelegramAlerts,
  card: Extract<Card, { type: "quotes" }>,
  cq: CallbackQuery,
): Promise<boolean> {
  if (!cq.message) return false;
  const [, , h = "0", p = "0"] = (cq.data ?? "").split(":");
  const s = slide(card, Number(h), Number(p));
  const target = { chat_id: String(cq.message.chat.id), message_id: cq.message.message_id };
  const reply_markup = { inline_keyboard: s.rows };
  const res = !cq.message.photo
    ? await t.tg("editMessageText", {
        ...target,
        text: s.caption,
        parse_mode: "HTML",
        reply_markup,
      })
    : s.photo
      ? await t.tg("editMessageMedia", {
          ...target,
          media: { type: "photo", media: s.photo, caption: s.caption, parse_mode: "HTML" },
          reply_markup,
        })
      : await t.tg("editMessageCaption", {
          ...target,
          caption: s.caption,
          parse_mode: "HTML",
          reply_markup,
        });
  return res.ok;
}
