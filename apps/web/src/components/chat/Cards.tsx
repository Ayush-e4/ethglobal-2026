"use client";

import type { Card } from "@app/shared";
import { shortAddress, usdc } from "@/lib/api";
import { HireCard } from "./HireCard";
import { LimitCard } from "./LimitCard";

/** What a card can do: send a reply as the user, and know whether it's the latest one. */
export interface CardCtx {
  chatId: string;
  isDemo: boolean;
  onReply: (text: string) => void;
  busy?: boolean; // only the latest reply's cards can be acted on
}

type Of<T extends Card["type"]> = Extract<Card, { type: T }>;

const SKILL_TONE: Record<string, string> = {
  flights: "bg-[#EEEAF8] text-[#4E3D8F]",
  hotels: "bg-teal-soft text-teal",
};
const btn =
  "flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold disabled:opacity-50";
const money = (n: number, currency?: string) =>
  currency === "INR" || !currency
    ? `₹${Math.round(n).toLocaleString("en-IN")}`
    : `${Math.round(n).toLocaleString()} ${currency}`;
const initials = (name: string) =>
  name
    .split(/[\s·]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

export function CardView({ card, ctx }: { card: Card; ctx: CardCtx }) {
  switch (card.type) {
    case "agents":
      return <Agents card={card} />;
    case "options":
      return <Options card={card} ctx={ctx} />;
    case "quotes":
      return <Quotes card={card} ctx={ctx} />;
    case "hire":
      return <HireCard card={card} ctx={ctx} />;
    case "limit":
      return <LimitCard card={card} ctx={ctx} />;
  }
}

function Agents({ card }: { card: Of<"agents"> }) {
  return (
    <section
      aria-label="Agents on the market"
      className="overflow-hidden rounded-2xl border border-line"
    >
      <div className="flex items-center gap-2.5 bg-side px-4 py-3 text-[13px] font-semibold">
        From the market{card.skill !== "all" ? ` · ${card.skill}` : ""}
        <span className="ml-auto font-normal text-ink-3">fee per job</span>
      </div>
      <ul>
        {card.agents.map((a) => (
          <li
            key={`${a.agent}-${a.skill}`}
            className="flex flex-wrap items-center gap-3 border-t border-[#F1EEE8] px-4 py-3.5"
          >
            <span
              aria-hidden
              className={`flex size-[34px] flex-none items-center justify-center rounded-[10px] text-xs font-bold ${SKILL_TONE[a.skill] ?? "bg-bubble text-ink-2"}`}
            >
              {initials(a.name)}
            </span>
            <span className="flex min-w-0 flex-[1_1_220px] flex-col gap-0.5">
              <span className="text-sm font-semibold">{a.name}</span>
              <span className="text-xs text-muted">{a.description}</span>
            </span>
            <span className="flex flex-col items-end gap-0.5">
              <span className="font-mono text-[13px]">{usdc(a.priceUnits)} USDC</span>
              <span className="font-mono text-[11px] text-muted">{shortAddress(a.agent)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Options({ card, ctx }: { card: Of<"options">; ctx: CardCtx }) {
  return (
    <section
      aria-label={card.question}
      className="flex flex-col gap-3 rounded-2xl border border-warm-line bg-warm p-4"
    >
      <span className="text-[15px] font-semibold">{card.question}</span>
      <div className="flex flex-wrap gap-2">
        {card.options.map((o) => (
          <button
            key={o.label}
            type="button"
            disabled={ctx.busy}
            onClick={() => ctx.onReply(o.reply)}
            className="flex min-h-11 flex-[1_1_180px] flex-col items-start justify-center gap-0.5 rounded-xl border border-line-2 bg-white px-4 py-2.5 text-left hover:border-teal disabled:opacity-50"
          >
            <span className="text-sm font-semibold">{o.label}</span>
            {o.detail && <span className="text-xs text-muted">{o.detail}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}

/** Live, firm quotes; choosing one tells the concierge which to book. */
function Quotes({ card, ctx }: { card: Of<"quotes">; ctx: CardCtx }) {
  return (
    <section aria-label={`${card.skill} quotes`} className="flex flex-col gap-3">
      <span className="text-[13px] text-ink-3">
        <span className="font-semibold text-ink">Quotes for {card.skill}</span> · {card.reason}
      </span>
      <div className="flex flex-wrap gap-3">
        {card.quotes.map((q, i) => (
          <article
            key={q.key}
            className={`flex flex-[1_1_260px] flex-col gap-3 rounded-2xl bg-white p-4 ${i === 0 ? "border-2 border-teal" : "border border-line"}`}
          >
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold">{q.title}</span>
              {i === 0 && card.quotes.length > 1 && (
                <span className="ml-auto rounded-full bg-saffron-soft px-2.5 py-0.5 text-xs font-bold text-saffron-ink">
                  Best value
                </span>
              )}
            </div>
            <p className="text-[13px] leading-relaxed text-ink-3">{q.note}</p>
            <div className="mt-auto flex items-end justify-between gap-3 border-t border-[#F1EEE8] pt-3">
              <span className="flex flex-col">
                <span className="text-xl font-bold">
                  {q.itemTotal ? money(q.itemTotal, q.itemCurrency) : "—"}
                </span>
                <span className="text-xs text-muted">
                  agent fee <span className="font-mono">{usdc(q.feeUnits)} USDC</span>, paid on
                  delivery
                </span>
              </span>
              <button
                type="button"
                disabled={ctx.busy}
                onClick={() => ctx.onReply(q.reply)}
                className={`${btn} flex-none whitespace-nowrap ${i === 0 ? "bg-teal text-white" : "border border-line-2 bg-white"}`}
              >
                Choose
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
