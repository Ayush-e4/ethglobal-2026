import { formatUsdc } from "@app/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  alertChannels,
  type Hire,
  hireAlerts,
  hires,
  quotes,
  type User,
  users,
} from "../db/schema";
import { DISPUTE_REASONS, type DisputeReason, DisputeReasonSchema } from "../hiring/disputes";
import type { WorldRatings } from "../world/ratings";
import type { TelegramAlerts } from "./telegram";

export interface CallbackQuery {
  id: string;
  data?: string;
  message?: { chat: { id: number }; message_id: number; photo?: unknown[] };
}

export interface LiveHiresDeps {
  db: Db;
  t: TelegramAlerts;
  appOrigin: string;
  cancel: (user: User, chatId: string, hireId: string) => Promise<unknown>; // undo
  ratings: WorldRatings | null;
  /** Report a problem (disputes.ts): from the message's button, while the review is open. */
  dispute?: (user: User, chatId: string, hireId: string, reason: DisputeReason) => Promise<unknown>;
  now?: () => number;
  log?: (line: string) => void;
}

type Button = { text: string; callback_data?: string; url?: string; style?: "danger" | "success" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clock = (d: Date) =>
  d.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit", // the undo window is about a minute
  });
const usdc = (units: bigint) => `${formatUsdc(units)} USDC`;

/**
 * Each hire, live in its owner's Telegram: one message (with the hotel's photo) edited as the
 * hire moves on, so the phone shows where it is: held with an Undo button, booked with its
 * reference, paid out, rebooked cheaper, rated. Edits are silent; the chat's own messages are the
 * alerts that buzz (routes.ts). Buttons work only from the chat the owner linked.
 */
export function liveHires(d: LiveHiresDeps) {
  const { db, t } = d;
  const now = d.now ?? Date.now;
  const log = d.log ?? ((line: string) => console.error(line));
  const queue = new Map<string, Promise<unknown>>(); // one update at a time per hire

  async function load(hireId: string) {
    if (!UUID.test(hireId)) return null;
    const [r] = await db
      .select({
        hire: hires,
        image: quotes.image,
        agent: quotes.agentAddress,
        tg: alertChannels.telegramChatId,
      })
      .from(hires)
      .leftJoin(quotes, eq(quotes.key, hires.quoteKey))
      .leftJoin(alertChannels, eq(alertChannels.userId, hires.userId))
      .where(eq(hires.id, hireId));
    return r ?? null;
  }

  function render(h: Hire, rated: number | null) {
    const undoOpen = h.status === "held" && !!h.undoUntil && h.undoUntil.getTime() > now();
    const ref = h.bookingRef ? `reference <code>${esc(h.bookingRef)}</code>` : "reference coming";
    const status: Record<Hire["status"], string> = {
      paying: "⏳ Paying the fee into escrow…",
      held: undoOpen
        ? `⏳ Fee held on Hedera. You can undo until ${clock(h.undoUntil as Date)}; then ${esc(h.agentName)} books it.`
        : `⏳ ${esc(h.agentName)} is booking it now.`,
      delivered: `✅ Booked, ${ref}. Hedera pays ${esc(h.agentName)} when the review window ends.`,
      released: `✅ Booked, ${ref}. 💸 Hedera paid ${esc(h.agentName)}.`,
      cancelled: "↩ Undone: nothing was booked, and the fee is back on your limit.",
      refunded: `⚠️ ${esc(h.agentName)} couldn't do it and refunded the fee. Nothing was charged.`,
      failed: `⚠️ It didn't go through${h.note ? ` (${esc(h.note)})` : ""}. Nothing was charged.`,
      disputed: `⚠️ You reported a problem: the fee is frozen on Hedera while ${esc(h.agentName)} sorts it out.`,
    };
    const lines = [
      `<b>${esc(h.title)}</b>`,
      `${esc(h.agentName)} · fee ${usdc(h.feeUnits)}, paid only when it's done`,
      "",
      status[h.status],
      ...(h.watchNote ? [`📉 ${esc(h.watchNote)}`] : []),
      ...(rated
        ? [`★ You rated ${esc(h.agentName)} ${rated}/5 (on Arkiv, as a verified person)`]
        : []),
    ];
    const rows: Button[][] = [];
    if (undoOpen) rows.push([{ text: "↩ Undo", callback_data: `undo:${h.id}`, style: "danger" }]);
    const reviewOpen =
      h.status === "delivered" && !!h.reviewUntil && h.reviewUntil.getTime() > now();
    if (reviewOpen && d.dispute)
      rows.push([{ text: "⚠️ Report a problem", callback_data: `rp:${h.id}` }]);
    if ((h.status === "delivered" || h.status === "released") && d.ratings)
      rows.push(
        [1, 2, 3, 4, 5].map((n) => ({
          text: `${n}★`,
          callback_data: `rate:${h.id}:${n}`,
          ...(rated === n ? { style: "success" as const } : {}),
        })),
      );
    const links: Button[] = [];
    if (h.payTx)
      links.push({ text: "Payment", url: `https://hashscan.io/testnet/transaction/${h.payTx}` });
    // Telegram refuses buttons to localhost: on a laptop the chat link is in the alerts' text.
    if (d.appOrigin.startsWith("https://"))
      links.push({ text: "Open chat", url: `${d.appOrigin}/chat/${h.chatId}` });
    if (links.length) rows.push(links);
    const text = lines.join("\n");
    return { text, rows, shown: JSON.stringify({ text, rows }) };
  }

  async function update(hireId: string) {
    const r = await load(hireId);
    if (!t.on || !r?.tg) return;
    const rated =
      r.agent && d.ratings ? ((await d.ratings.mine(r.hire.userId, r.agent))?.score ?? null) : null;
    const v = render(r.hire, rated);
    const [card] = await db.select().from(hireAlerts).where(eq(hireAlerts.hireId, hireId));
    if (card?.telegramChatId === r.tg && card.shown === v.shown) return;
    const markup = { inline_keyboard: v.rows };
    if (card?.telegramChatId === r.tg) {
      const res = await t.tg(card.photo ? "editMessageCaption" : "editMessageText", {
        chat_id: r.tg,
        message_id: card.messageId,
        [card.photo ? "caption" : "text"]: v.text,
        parse_mode: "HTML",
        reply_markup: markup,
      });
      if (res.ok || /not modified/.test(res.description ?? ""))
        await db.update(hireAlerts).set({ shown: v.shown }).where(eq(hireAlerts.hireId, hireId));
      else log(`telegram: editing hire ${hireId.slice(0, 8)}: ${res.description}`);
      return;
    }
    // New (or the owner linked another Telegram chat since): send it, with the photo if it loads.
    const base = { chat_id: r.tg, parse_mode: "HTML", reply_markup: markup };
    let res = r.image
      ? await t.tg("sendPhoto", { ...base, photo: r.image, caption: v.text }).catch(() => null)
      : null;
    const photo = Boolean(res?.ok);
    if (!res?.ok)
      res = await t.tg("sendMessage", {
        ...base,
        text: v.text,
        link_preview_options: { is_disabled: true },
      });
    if (!res?.ok) return log(`telegram: sending hire ${hireId.slice(0, 8)}: ${res?.description}`);
    const messageId = (res.result as { message_id: number }).message_id;
    const row = { telegramChatId: r.tg, messageId, photo, shown: v.shown };
    await db
      .insert(hireAlerts)
      .values({ hireId, ...row })
      .onConflictDoUpdate({ target: hireAlerts.hireId, set: row });
  }

  /** Brings the hire's Telegram message up to date (sends it the first time). Never throws. */
  function show(hireId: string): Promise<void> {
    const next = (queue.get(hireId) ?? Promise.resolve())
      .then(() => update(hireId))
      .catch((err) => log(`telegram: hire ${hireId.slice(0, 8)}: ${String(err).slice(0, 120)}`))
      .finally(() => {
        if (queue.get(hireId) === next) queue.delete(hireId);
      });
    queue.set(hireId, next);
    return next;
  }

  /** A tap on a hire message's button: Undo, or a rating. Only from the owner's linked chat. */
  async function onCallback(cq: CallbackQuery) {
    const [kind, hireId = "", n] = (cq.data ?? "").split(":");
    const answer = (text: string, alert = false) =>
      t
        .tg("answerCallbackQuery", { callback_query_id: cq.id, text, show_alert: alert })
        .catch(() => null);
    const r = await load(hireId);
    if (!r?.tg || r.tg !== String(cq.message?.chat.id))
      return answer("This booking isn't linked to this chat any more.", true);
    const [user] = await db.select().from(users).where(eq(users.id, r.hire.userId));
    if (!user) return answer("Account not found.", true);
    if (kind === "rp" && cq.message) {
      // The reasons, in place of the buttons; "Back" puts them back.
      await answer("What's wrong?");
      await t.tg("editMessageReplyMarkup", {
        chat_id: r.tg,
        message_id: cq.message.message_id,
        reply_markup: {
          inline_keyboard: [
            ...Object.entries(DISPUTE_REASONS).map(([id, label]) => [
              { text: label, callback_data: `rr:${hireId}:${id}` },
            ]),
            [{ text: "Back", callback_data: `rx:${hireId}` }],
          ],
        },
      });
      return;
    }
    if (kind === "rx") {
      await answer("");
      await db.update(hireAlerts).set({ shown: "" }).where(eq(hireAlerts.hireId, hireId));
      return show(hireId);
    }
    if (kind === "rr") {
      const reason = DisputeReasonSchema.safeParse(n);
      if (!d.dispute || !reason.success) return answer("That button is out of date.");
      try {
        await d.dispute(user, r.hire.chatId, hireId, reason.data);
        await answer("Reported: the fee is frozen while the agent sorts it out.");
      } catch (err) {
        await answer(err instanceof Error ? err.message : "Couldn't report it.", true);
      }
      await db.update(hireAlerts).set({ shown: "" }).where(eq(hireAlerts.hireId, hireId));
      return show(hireId);
    }
    if (kind === "undo") {
      try {
        await d.cancel(user, r.hire.chatId, hireId);
        await answer("Undone: nothing was booked.");
      } catch (err) {
        await answer(err instanceof Error ? err.message : "Couldn't undo it.", true);
      }
    } else if (kind === "rate") {
      if (!d.ratings) return answer("Ratings are off on this server.", true);
      if (!user.worldIss || !user.worldSub)
        return answer(
          "Ratings count only from verified people: rate it in AgentNet, on the booking's card, with World ID.",
          true,
        );
      const note = await d.ratings.rate(user.id, hireId, Number(n), {
        iss: user.worldIss,
        sub: user.worldSub,
      });
      await answer(
        note ? `${note[0]?.toUpperCase()}${note.slice(1)}.` : `Rated ${n}/5, on Arkiv.`,
        !!note,
      );
    } else return answer("That button is out of date.");
    await show(hireId);
  }

  return { show, onCallback, render };
}

export type LiveHires = ReturnType<typeof liveHires>;
