import type { Card } from "@app/shared";
import type { AlertChannel } from "../db/schema";
import { MAX_TRAVELLERS, parseGuest, type TravellerService } from "../travellers/service";
import type { CallbackQuery } from "./live-hires";
import type { TelegramAlerts } from "./telegram";
import { esc } from "./telegram-format";

const EXAMPLE = "Asha Rao, asha@example.com, +91 98000 00000";
type Say = (chatId: string, text: string, extra?: Record<string, unknown>) => Promise<unknown>;
type TravellerCard = Extract<Card, { type: "traveller" }>;

/**
 * "Who is this booking for?" in Telegram: a button per saved traveller, and "Someone else",
 * whose details come in the next message. That message is caught here, so a guest's name, email
 * and phone never reach the concierge or the chat history; they're saved as a traveller.
 */
export function telegramTravellers(
  t: TelegramAlerts,
  travellers: TravellerService | undefined,
  say: Say,
) {
  const awaiting = new Map<string, string>(); // Telegram chat → the booking to carry on

  return {
    forget: (tgChatId: string) => awaiting.delete(tgChatId),

    async ask(tgChatId: string, userId: string, card: TravellerCard) {
      const list = (await travellers?.list(userId)) ?? [];
      const rows = list.map((tr) => [
        {
          text: `${tr.firstName} ${tr.lastName.slice(0, 1)}.${tr.isSelf ? " (me)" : ""}`,
          callback_data: `tv:${tr.id}`,
        },
      ]);
      if (list.length < MAX_TRAVELLERS)
        rows.push([{ text: "➕ Someone else", callback_data: "tv:new" }]);
      await say(
        tgChatId,
        `<b>Who is this booking for?</b>\nTheir name, email and phone go only to ${esc(card.agentName)}, for this booking, and on to the hotel or airline.`,
        { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } },
      );
    },

    /** A traveller button. Returns the booking to carry on, if it's chosen. */
    async pick(
      cq: CallbackQuery,
      tgChatId: string,
      link: AlertChannel | null,
      card: TravellerCard | undefined,
    ): Promise<string | null> {
      const answer = (text: string) =>
        t.tg("answerCallbackQuery", { callback_query_id: cq.id, text }).catch(() => null);
      if (!link?.appChatId || !card || !travellers) {
        await answer("That booking has moved on: ask again.");
        return null;
      }
      if (cq.data === "tv:new") {
        awaiting.set(tgChatId, card.reply);
        await answer("Who's travelling?");
        await say(
          tgChatId,
          `Reply with the guest's name, email and phone, like: ${EXAMPLE}\nFor a flight, add the date of birth and gender too: ${EXAMPLE}, 1990-05-14, F`,
          {
            reply_markup: { force_reply: true, input_field_placeholder: "Name, email, phone" },
          },
        );
        return null;
      }
      const ok = await travellers.choose(link.userId, link.appChatId, (cq.data ?? "").slice(3));
      await answer(ok ? "On it…" : "That traveller isn't saved any more.");
      return ok ? card.reply : null;
    },

    /**
     * After "Someone else": is this message the guest's details? Handled means don't pass it on;
     * `carryOn` is the booking to send once they're saved.
     */
    async intercept(
      tgChatId: string,
      userId: string,
      appChatId: string | null,
      text: string,
    ): Promise<{ handled: boolean; carryOn?: string }> {
      const pending = awaiting.get(tgChatId);
      if (!pending || !travellers || !appChatId || text.startsWith("/")) return { handled: false };
      const g = parseGuest(text);
      if ("error" in g) {
        await say(tgChatId, `${g.error}. Reply like: ${EXAMPLE}`);
        return { handled: true };
      }
      awaiting.delete(tgChatId);
      const saved = await travellers.add(userId, g).catch((e: Error) => e);
      if (saved instanceof Error) {
        await say(tgChatId, `${saved.message}.`);
        return { handled: true };
      }
      await travellers.choose(userId, appChatId, saved.id);
      await say(
        tgChatId,
        `Saved ${saved.firstName} ${saved.lastName} as a traveller. Booking for them…`,
      );
      return { handled: true, carryOn: pending };
    },
  };
}
