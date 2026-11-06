import type { Card } from "@app/shared";

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const usdc = (units: string) => {
  const n = Number(units) / 1e6;
  return `${n > 0 && n < 0.01 ? String(Number(n.toFixed(4))) : n.toFixed(2)} USDC`;
};
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

type Offer = Extract<Card, { type: "quotes" }>["quotes"][number];

/** "PriceGuard: Book and keep watching · 0.05 USDC": one button per agent offering a hotel. */
export function bookLabel(q: Offer, withPrice = false) {
  const agent = q.title.split(" · ")[1];
  const price =
    withPrice && q.itemTotal !== undefined ? ` · ${money(q.itemTotal, q.itemCurrency)}` : "";
  const who = agent ? (q.model ? `${agent}: ${q.model}` : `Book with ${agent}`) : "Book it";
  return `${who} · ${usdc(q.feeUnits)}${price}`;
}

/**
 * Offers by hotel, in the order shown: the same hotel often comes from several agents (one books,
 * one keeps watching the price), so each hotel is one message with a button per agent.
 */
export function offersByHotel(quotes: Offer[]) {
  const groups = new Map<string, Offer[]>();
  for (const q of quotes) {
    const hotel = q.title.split(" · ")[0] ?? q.title;
    groups.set(hotel, [...(groups.get(hotel) ?? []), q]);
  }
  return [...groups].map(([hotel, offers]) => ({ hotel, offers }));
}

type QuotesCard = Extract<Card, { type: "quotes" }>;

/** The hotel's details for a carousel slide: name, why it's here, the stay, verified ratings. */
function hotelCaption(hotel: string, offers: Offer[]) {
  const q = offers[0] as Offer;
  const samePrice = offers.every((o) => o.itemTotal === q.itemTotal);
  const facts = [
    samePrice && q.itemTotal !== undefined ? money(q.itemTotal, q.itemCurrency) : null,
    q.rating?.stars ? `${q.rating.stars}-star` : null,
    q.rating?.score ? `${q.rating.score}/10` : null,
    q.location ?? null,
    q.refundable ? "free cancellation" : null,
  ].filter(Boolean);
  const tags = [...new Set(offers.map((o) => o.tag).filter(Boolean))].join(" · ");
  const rated = offers
    .filter((o) => o.agentRating)
    .map(
      (o) =>
        `${o.title.split(" · ")[1]} ★ ${o.agentRating?.average.toFixed(1)} (${o.agentRating?.count} verified)`,
    );
  return {
    samePrice,
    caption: [
      `<b>${esc(hotel)}</b>${tags ? ` · ${esc(tags)}` : ""}`,
      esc(facts.join(" · ")),
      ...(q.note ? [esc(q.note)] : []),
      ...(rated.length ? [esc(`Rated by verified people: ${rated.join(", ")}`)] : []),
    ].join("\n"),
  };
}

/** Which offers card a carousel button belongs to: its first quote's key, shortened. */
export const carouselRef = (card: QuotesCard) => (card.quotes[0]?.key ?? "").slice(2, 14);

/**
 * One slide of the offers carousel, all in one message: hotel `h` (of up to 6 offers, grouped by
 * hotel) with photo `p` of its own (up to 4), ◀ ▶ between hotels, 📷 between its photos, and a
 * Book button per agent offering it. Indexes wrap around.
 */
export function slide(card: QuotesCard, h: number, p: number) {
  const hotels = offersByHotel(card.quotes.slice(0, 6)).map((g) => ({
    ...g,
    photos: [...new Set(g.offers.flatMap((o) => o.images ?? []))].slice(0, 4),
  }));
  const n = hotels.length;
  const i = ((h % n) + n) % n;
  const { hotel, offers, photos } = hotels[i] as (typeof hotels)[number];
  const j = photos.length ? ((p % photos.length) + photos.length) % photos.length : 0;
  const { caption, samePrice } = hotelCaption(hotel, offers);
  const ref = carouselRef(card);
  const go = (hi: number, pi: number) => `c:${ref}:${(hi + n) % n}:${pi}`;
  const rows: { text: string; callback_data: string }[][] = [];
  if (n > 1)
    rows.push([
      { text: "◀", callback_data: go(i - 1, 0) },
      { text: `Hotel ${i + 1} of ${n}`, callback_data: "n" },
      { text: "▶", callback_data: go(i + 1, 0) },
    ]);
  if (photos.length > 1)
    rows.push([
      {
        text: `📷 Photo ${j + 1} of ${photos.length} ›`,
        callback_data: go(i, (j + 1) % photos.length),
      },
    ]);
  for (const o of offers)
    rows.push([{ text: bookLabel(o, !samePrice), callback_data: quoteButton(o.key) }]);
  return { photo: photos[j] ?? null, caption, rows };
}

/** A quote's button data: "b:" and the first 40 hex digits of its key (Telegram allows 64 bytes). */
export const quoteButton = (key: string) => `b:${key.slice(2, 42)}`;

/**
 * A card as Telegram messages, the way the app shows it: offers as one carousel message (see
 * `slide`), choices as buttons. A hire is its own live message (live-hires.ts); a World ID
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
    ? [[{ text: "Open in Shikigami", url: appLink }]]
    : undefined;
  switch (card.type) {
    case "quotes": {
      const first = slide(card, 0, 0);
      const markup = { inline_keyboard: first.rows };
      return [
        first.photo
          ? {
              method: "sendPhoto",
              body: {
                photo: first.photo,
                caption: first.caption,
                parse_mode: "HTML",
                reply_markup: markup,
              },
            }
          : msg(first.caption, first.rows),
      ];
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
                `• <b>${esc(a.name)}</b>${a.model ? ` (${esc(a.model)})` : ""}: ${usdc(a.priceUnits)} a ${a.kind === "lookup" ? "lookup" : "job"}${a.delivered ? `, ${a.delivered} delivered` : ""}${a.rating ? `, ★ ${a.rating.average.toFixed(1)} from ${a.rating.count} verified` : ""}\n  ${esc(a.description)}`,
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
    case "answer":
      return [
        msg(
          `<b>${esc(card.title)}</b> · ${esc(card.agentName)}\n${card.lines.map((l) => `${esc(l.label)}: ${esc(l.value)}`).join("\n")}\n\n<i>From ${esc(card.source)}. Paid ${usdc(card.feeUnits)}:</i> <a href="https://hashscan.io/testnet/transaction/${esc(card.payTx)}">see it on Hedera</a>`,
        ),
      ];
    case "limit":
      return [
        msg(
          `To pay ${esc(card.agentName)} from your own wallet, approve a spending limit with Face ID in Shikigami: up to ${usdc(card.budgetUnits)} in this chat, for ${card.hours} hours. The booking then carries on, and it shows up here live.${web ? "" : `\n\n${esc(appLink ?? "")}`}`,
          web,
        ),
      ];
    default:
      return []; // "hire": its live message; "human": started by the chat
  }
}
