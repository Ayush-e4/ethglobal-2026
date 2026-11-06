import type { Card } from "@app/shared";

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const usdc = (units: string) => `${(Number(units) / 1e6).toFixed(2)} USDC`;
const money = (n: number, currency = "INR") =>
  currency === "INR" ? `₹${Math.round(n).toLocaleString("en-IN")}` : `${currency} ${Math.round(n)}`;

/** The concierge's Markdown as Telegram HTML: bold, code, headings, links, lists; the rest escaped. */
export function html(md: string): string {
  return esc(md)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^\s*[-*]\s+/gm, "• ")
    .trim();
}

/** While a reply streams: plain text (no half-made tags or links), the newest 4,000 characters. */
export const draftText = (md: string) =>
  md
    .replace(/\*\*/g, "")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]*)\)?/g, "$1")
    .slice(-4000);

/** Telegram's 4,096-character limit: split on paragraph breaks. */
export function chunks(text: string, max = 3900): string[] {
  const out: string[] = [];
  let cur = "";
  for (const para of text.split("\n\n")) {
    if (cur && cur.length + para.length + 2 > max) {
      out.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n\n${para}` : para.slice(0, max);
  }
  if (cur) out.push(cur);
  return out;
}

export interface Send {
  method: string;
  body: Record<string, unknown>;
}

/** "Book 2: Park Inn by Radisson Goa… · PriceGuard": the same hotel can come from two agents. */
export function bookLabel(i: number, title: string) {
  const [hotel = title, agent] = title.split(" · ");
  const cut = hotel.slice(0, 28);
  const short =
    hotel.length > 28 ? `${cut.slice(0, cut.lastIndexOf(" ")).trimEnd() || cut}…` : hotel;
  return `Book ${i + 1}: ${short}${agent ? ` · ${agent}` : ""}`;
}

/** A quote's button data: "b:" and the first 40 hex digits of its key (Telegram allows 64 bytes). */
export const quoteButton = (key: string) => `b:${key.slice(2, 42)}`;

/**
 * A card as Telegram messages, the way the app shows it: offers as a photo album and a list with
 * Book buttons, choices as buttons. A hire is its own live message (live-hires.ts); a World ID
 * approval is handled by the chat (it starts a check). `appLink` is the chat on the web.
 */
export function cardMessages(card: Card, appLink: string | null): Send[] {
  const msg = (text: string, rows?: unknown[][]): Send => ({
    method: "sendMessage",
    body: {
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(rows ? { reply_markup: { inline_keyboard: rows } } : {}),
    },
  });
  const web = appLink?.startsWith("https://")
    ? [[{ text: "Open in AgentNet", url: appLink }]]
    : undefined;
  switch (card.type) {
    case "quotes": {
      const qs = card.quotes.slice(0, 6);
      const photos = qs
        .map((q, i) => ({ q, i, img: q.images?.[0] }))
        .filter((x): x is { q: (typeof qs)[number]; i: number; img: string } => !!x.img);
      const album: Send[] =
        photos.length >= 2
          ? [
              {
                method: "sendMediaGroup",
                body: {
                  media: photos.map(({ q, i, img }) => ({
                    type: "photo",
                    media: img,
                    caption: `${i + 1}. ${q.title}${q.itemTotal !== undefined ? ` · ${money(q.itemTotal, q.itemCurrency)}` : ""}`,
                  })),
                },
              },
            ]
          : [];
      const lines = qs.map((q, i) => {
        const facts = [
          q.itemTotal !== undefined ? money(q.itemTotal, q.itemCurrency) : null,
          q.rating?.stars ? `${q.rating.stars}-star` : null,
          q.rating?.score ? `${q.rating.score}/10` : null,
          q.location ?? null,
          q.refundable ? "free cancellation" : null,
        ].filter(Boolean);
        const agent = [
          q.model,
          `fee ${usdc(q.feeUnits)}`,
          q.agentRating
            ? `★ ${q.agentRating.average.toFixed(1)} (${q.agentRating.count} verified)`
            : null,
        ].filter(Boolean);
        return `${i + 1}. <b>${esc(q.title)}</b>${q.tag ? ` · ${esc(q.tag)}` : ""}\n   ${esc(facts.join(" · "))}\n   ${esc(agent.join(" · "))}`;
      });
      const rows = qs.map((q, i) => [
        {
          text: bookLabel(i, q.title),
          callback_data: quoteButton(q.key),
        },
      ]);
      return [...album, msg(`<b>${esc(card.reason)}</b>\n\n${lines.join("\n\n")}`, rows)];
    }
    case "options":
      return [
        msg(
          esc(card.question),
          card.options.map((o, i) => [{ text: o.label.slice(0, 60), callback_data: `o:${i}` }]),
        ),
      ];
    case "agents":
      return [
        msg(
          card.agents
            .map(
              (a) =>
                `• <b>${esc(a.name)}</b>${a.model ? ` (${esc(a.model)})` : ""}: ${usdc(a.priceUnits)} a job${a.delivered ? `, ${a.delivered} delivered` : ""}${a.rating ? `, ★ ${a.rating.average.toFixed(1)} from ${a.rating.count} verified` : ""}\n  ${esc(a.description)}`,
            )
            .join("\n"),
        ),
      ];
    case "sources":
      return [
        msg(
          `Sources:\n${card.sources.map((s) => `• <a href="${esc(s.url)}">${esc(s.title)}</a>`).join("\n")}`,
        ),
      ];
    case "limit":
      return [
        msg(
          `To pay ${esc(card.agentName)} from your own wallet, approve a spending limit with Face ID in AgentNet: up to ${usdc(card.budgetUnits)} in this chat, for ${card.hours} hours. The booking then carries on, and it shows up here live.${web ? "" : `\n\n${esc(appLink ?? "")}`}`,
          web,
        ),
      ];
    default:
      return []; // "hire": its live message; "human": started by the chat
  }
}
