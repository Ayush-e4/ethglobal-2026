"use client";

import type { Card } from "@app/shared";
import { useState } from "react";
import { usdc } from "@/lib/api";
import { PinIcon, StarIcon } from "../icons";
import type { CardCtx } from "./Cards";

type QuotesCardData = Extract<Card, { type: "quotes" }>;
type Quote = QuotesCardData["quotes"][number];

const money = (n: number, currency?: string) =>
  currency === "INR" || !currency
    ? `₹${Math.round(n).toLocaleString("en-IN")}`
    : `${Math.round(n).toLocaleString()} ${currency}`;

/** The offer's photos: swipe through them (third-party images, so no referrer is sent). */
function Photos({ q }: { q: Quote }) {
  const [broken, setBroken] = useState<string[]>([]);
  const images = (q.images ?? []).filter((u) => !broken.includes(u));
  if (images.length === 0) return null;
  return (
    <div className="relative">
      <div className="flex snap-x snap-mandatory overflow-x-auto rounded-t-2xl [scrollbar-width:none]">
        {images.map((src, i) => (
          // biome-ignore lint/performance/noImgElement: third-party hotel photos, no image proxy
          <img
            key={src}
            src={src}
            alt={i === 0 ? q.title : ""}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setBroken((b) => [...b, src])}
            className="aspect-[16/10] w-full flex-none snap-start bg-side object-cover"
          />
        ))}
      </div>
      {q.tag && (
        <span className="absolute top-2.5 left-2.5 rounded-full bg-white/95 px-2.5 py-0.5 text-xs font-bold text-teal shadow-sm">
          {q.tag}
        </span>
      )}
      {images.length > 1 && (
        <span className="absolute right-2.5 bottom-2.5 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">
          {images.length} photos
        </span>
      )}
    </div>
  );
}

/** One offer: what it is, why it's here, what it costs, and Choose. */
function Offer({ q, first, ctx }: { q: Quote; first: boolean; ctx: CardCtx }) {
  const [name, agent] = q.title.split(" · ");
  const r = q.rating;
  const hasPhotos = (q.images?.length ?? 0) > 0;
  return (
    <article
      className={`flex w-[85%] flex-none snap-start flex-col overflow-hidden rounded-2xl bg-white sm:w-auto sm:flex-1 ${first ? "border-2 border-teal" : "border border-line"}`}
    >
      <Photos q={q} />
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        {!hasPhotos && q.tag && (
          <span className="self-start rounded-full bg-teal-soft px-2.5 py-0.5 text-xs font-bold text-teal">
            {q.tag}
          </span>
        )}
        <div className="flex flex-col gap-0.5">
          <span className="text-[15px] leading-snug font-semibold">{name}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-3">
            {r?.stars ? (
              <span className="flex items-center gap-0.5">
                <StarIcon size={12} className="text-saffron" /> {Math.round(r.stars)}-star
              </span>
            ) : null}
            {r?.score ? (
              <span>
                <span className="rounded-md bg-teal px-1.5 py-px font-semibold text-white">
                  {r.score.toFixed(1)}
                </span>
                {r.reviews ? ` ${r.reviews.toLocaleString("en-IN")} reviews` : ""}
              </span>
            ) : null}
            {agent && <span>by {agent}</span>}
          </span>
        </div>
        {q.location && (
          <span className="flex items-start gap-1 text-xs text-ink-3">
            <PinIcon size={13} className="mt-px flex-none" /> {q.location}
          </span>
        )}
        {q.note && <p className="text-[13px] leading-relaxed text-ink-2">{q.note}</p>}
        {q.details?.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {q.details.map((d) => (
              <li key={d} className="rounded-full bg-side px-2 py-0.5 text-[11px] text-ink-3">
                {d}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-auto flex items-end justify-between gap-3 border-t border-[#F1EEE8] pt-3">
          <span className="flex min-w-0 flex-col">
            <span className="text-lg font-bold">
              {q.itemTotal ? money(q.itemTotal, q.itemCurrency) : "—"}
            </span>
            {q.refundable && <span className="text-xs font-medium text-ok">Free cancellation</span>}
            <span className="text-xs text-muted">
              agent fee <span className="font-mono">{usdc(q.feeUnits)} USDC</span>, on delivery
            </span>
          </span>
          <button
            type="button"
            disabled={ctx.busy}
            onClick={() => ctx.onReply(q.reply)}
            className={`flex min-h-11 flex-none items-center justify-center rounded-xl px-4 text-sm font-semibold whitespace-nowrap disabled:opacity-50 ${first ? "bg-teal text-white" : "border border-line-2 bg-white"}`}
          >
            Choose
          </button>
        </div>
      </div>
    </article>
  );
}

/** Firm offers for one job, each picked for a reason; tapping one tells the concierge which. */
export function QuotesCard({ card, ctx }: { card: QuotesCardData; ctx: CardCtx }) {
  return (
    <section aria-label={`${card.skill} offers`} className="flex flex-col gap-3">
      <span className="text-[13px] text-ink-3">
        <span className="font-semibold text-ink">Offers for {card.skill}</span> · {card.reason}
      </span>
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:none]">
        {card.quotes.map((q, i) => (
          <Offer key={q.key} q={q} first={i === 0} ctx={ctx} />
        ))}
      </div>
    </section>
  );
}
