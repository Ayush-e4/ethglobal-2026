"use client";

import type { Card } from "@app/shared";
import { shortAddress, usdc } from "@/lib/api";
import { HireCard } from "./HireCard";
import { LimitCard } from "./LimitCard";
import { QuotesCard } from "./QuotesCard";

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
      return <QuotesCard card={card} ctx={ctx} />;
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
