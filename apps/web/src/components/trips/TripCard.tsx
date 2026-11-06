"use client";

import Link from "next/link";
import { useState } from "react";
import { cardLine, hashscanTx, rupeesOf, type Trip, usdc } from "@/lib/api";
import { RateAgent } from "../chat/RateAgent";
import { ReportProblem } from "../chat/ReportProblem";
import { CancelBooking } from "./CancelBooking";

const PILL: Record<Trip["status"], [string, string]> = {
  paying: ["paying…", "bg-saffron-soft text-saffron-ink"],
  held: ["booking…", "bg-saffron-soft text-saffron-ink"],
  delivered: ["booked", "bg-ok-soft text-ok"],
  released: ["booked · agent paid", "bg-ok-soft text-ok"],
  cancelled: ["undone · nothing paid", "bg-side text-ink-3"],
  refunded: ["refunded", "bg-side text-ink-3"],
  failed: ["didn't go through", "bg-bad-soft text-bad"],
  disputed: ["reported · fee frozen", "bg-bad-soft text-bad"],
};
const date = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** One booking on the Trips page: what it is, where it stands, and what you can still do. */
export function TripCard({ trip }: { trip: Trip }) {
  const [t, setT] = useState(trip);
  const path = `/chats/${t.chatId}/hires/${t.id}`;
  const [pill, tone] = t.bookingCancelledAt
    ? (["cancelled afterwards", "bg-side text-ink-3"] as const)
    : PILL[t.status];
  const booked = t.status === "delivered" || t.status === "released";
  const update = (h: Partial<Trip>) => setT((x) => ({ ...x, ...h }));

  return (
    <section
      aria-label={t.title}
      className="flex flex-col gap-3 rounded-2xl border border-line p-4 sm:p-[18px]"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] font-bold">{t.title}</span>
          <span className="text-xs text-muted">
            {t.agentName} · fee <span className="font-mono">{usdc(t.feeUnits)} USDC</span> · hired{" "}
            {date(t.createdAt)}
          </span>
        </span>
        <span className={`flex-none rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>
          {pill}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
        {t.guestName && (
          <>
            <dt className="text-muted">Guest</dt>
            <dd>{t.guestName}</dd>
          </>
        )}
        {t.bookingRef && (
          <>
            <dt className="text-muted">Reference</dt>
            <dd className="font-mono">{t.bookingRef}</dd>
          </>
        )}
        {t.priceUnits && (
          <>
            <dt className="text-muted">In escrow</dt>
            <dd>
              {rupeesOf(t.priceUnits)} + fee{" "}
              <span className="text-xs text-muted">(testnet scale)</span>
            </dd>
          </>
        )}
        {t.card && (
          <>
            <dt className="text-muted">Paid with</dt>
            <dd>
              One-time card {cardLine(t.card)}{" "}
              <span className="text-xs text-muted">(simulated)</span>
            </dd>
          </>
        )}
        {t.watchNote && (
          <>
            <dt className="text-muted">Watching</dt>
            <dd>{t.watchNote}</dd>
          </>
        )}
        {t.note && !booked && (
          <>
            <dt className="text-muted">Note</dt>
            <dd>{t.note}</dd>
          </>
        )}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/chat/${t.chatId}`}
          className="flex min-h-9 max-md:min-h-11 items-center rounded-lg border border-line-2 bg-white px-3 text-xs font-semibold"
        >
          Open the chat
        </Link>
        <Link
          href={`/receipts/${t.id}`}
          className="flex min-h-9 max-md:min-h-11 items-center rounded-lg border border-line-2 bg-white px-3 text-xs font-semibold"
        >
          Receipt
        </Link>
        {t.payTx && (
          <a
            href={hashscanTx(t.payTx)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-teal underline underline-offset-2"
          >
            Fee on Hedera
          </a>
        )}
      </div>
      {t.canCancelBooking && !t.bookingCancelledAt && (
        <CancelBooking
          path={path}
          agentName={t.agentName}
          onCancelled={(h) => update({ ...h, canCancelBooking: false })}
        />
      )}
      {t.canReport && t.reviewUntil && (
        <ReportProblem path={path} reviewUntil={t.reviewUntil} onReported={update} />
      )}
      {booked && <RateAgent path={`${path}/rating`} agentName={t.agentName} />}
    </section>
  );
}
