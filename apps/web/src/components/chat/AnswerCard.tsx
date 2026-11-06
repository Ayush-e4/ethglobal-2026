import type { Card } from "@app/shared";
import { hashscanTx, usdc } from "@/lib/api";

/** A lookup agent's answer: what it found, where from, and its fee's payment on Hedera. */
export function AnswerCard({ card }: { card: Extract<Card, { type: "answer" }> }) {
  return (
    <section aria-label={card.title} className="overflow-hidden rounded-2xl border border-line">
      <div className="flex flex-wrap items-center gap-2 bg-side px-4 py-3">
        <span className="text-[13px] font-semibold">{card.title}</span>
        <span className="ml-auto text-xs text-ink-3">{card.agentName}</span>
      </div>
      <dl className="grid grid-cols-[minmax(84px,auto)_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-sm">
        {card.lines.map((l) => (
          <div key={l.label} className="contents">
            <dt className="text-muted">{l.label}</dt>
            <dd className="min-w-0 break-words">{l.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#F1EEE8] px-4 py-2.5 text-xs text-muted">
        <span>From {card.source}</span>
        <span className="ml-auto">
          Paid {usdc(card.feeUnits)} USDC ·{" "}
          <a
            href={hashscanTx(card.payTx)}
            target="_blank"
            rel="noreferrer noopener"
            className="text-teal underline-offset-2 hover:underline"
          >
            see it on Hedera
          </a>
        </span>
      </div>
    </section>
  );
}
