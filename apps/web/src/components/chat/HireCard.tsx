"use client";

import type { Card } from "@app/shared";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, type HireView, usdc } from "@/lib/api";
import { celebrate } from "@/lib/native/celebrate";
import { haptic } from "@/lib/native/haptics";
import { CancelBooking } from "../trips/CancelBooking";
import type { CardCtx } from "./Cards";
import { FINAL, hireExtras, hireSteps, type Status, type Step } from "./hire-steps";
import { PaymentReceipt } from "./PaymentReceipt";
import { RateAgent } from "./RateAgent";
import { ReportProblem } from "./ReportProblem";
import { UndoRing } from "./UndoRing";

type HireCardData = Extract<Card, { type: "hire" }>;
const left = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000));
/** The undo window's length: from the hire to the end of undo. */
const windowSecs = (from: string, to: string) =>
  Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * A hired agent, live. The fee is held on Hedera, not paid; until the undo window ends you can
 * undo and nothing is booked. Then the agent books, the chat gets the booking reference, and
 * Hedera pays the agent by itself once the review window ends. Undo works from any card, not only
 * the latest one: the window is short and the concierge may still be writing.
 */
export function HireCard({ card, ctx }: { card: HireCardData; ctx: CardCtx }) {
  const [hire, setHire] = useState<HireView | null>(null);
  const [gone, setGone] = useState(false); // the server doesn't know this hire any more
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  // A watching agent keeps working after it's paid: keep following it while it watches.
  const done = gone || (!!hire && FINAL.includes(hire.status) && !hire.watching);

  useEffect(() => {
    if (done) return; // a finished hire never changes: stop polling and ticking
    let stop = false;
    const load = () =>
      api<HireView[]>(`/chats/${ctx.chatId}/hires`)
        .then((all) => {
          if (stop) return;
          const h = all.find((x) => x.id === card.hireId);
          if (h) setHire(h);
          else setGone(true);
        })
        .catch(() => {}); // a blip: the next poll tries again
    void load();
    let n = 0;
    const t = setInterval(() => {
      tick((x) => x + 1); // the countdown
      if (++n % 3 === 0) void load();
    }, 1000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [card.hireId, ctx.chatId, done]);

  const undo = async () => {
    setCancelling(true);
    setError(null);
    try {
      setHire(
        await api<HireView>(`/chats/${ctx.chatId}/hires/${card.hireId}/cancel`, {
          method: "POST",
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server. Try again.");
    } finally {
      setCancelling(false);
    }
  };

  const status: Status = hire?.status ?? "held";
  // Booked while you watched (held → booked): the burst, from this card, and a buzz on Android.
  // A hire that was already booked when the chat opened stays quiet.
  const root = useRef<HTMLElement>(null);
  const was = useRef<Status | null>(null);
  useEffect(() => {
    if (!hire) return;
    if (was.current === "held" && (status === "delivered" || status === "released")) {
      celebrate(root.current);
      haptic("success");
    }
    was.current = status;
  }, [hire, status]);
  const name = hire?.agentName ?? "The agent";
  const fee = `${usdc(card.feeUnits)} USDC`;
  const secs = left(hire?.undoUntil ?? card.undoUntil);
  const canUndo = status === "held" && secs > 0 && !gone;

  const [demo, setDemo] = useState<string | null>(null);
  const simulateDrop = async () => {
    setDemo("Telling the agent the price dropped…");
    try {
      const r = await api<{ rebook: unknown | null }>(
        `/chats/${ctx.chatId}/hires/${card.hireId}/demo-drop`,
        { method: "POST" },
      );
      setDemo(
        r.rebook
          ? "The agent rebooked it cheaper. The chat says so in a moment."
          : "The agent checked: not cheaper enough to rebook this time.",
      );
    } catch (err) {
      setDemo(err instanceof ApiError ? err.message : "That didn't work.");
    }
  };

  const payTx = card.payTx || hire?.payTx || null;
  const steps = hireSteps({
    status,
    hire,
    name,
    paid: !!payTx,
    canUndo,
    undoLeft: clock(secs),
    undoUntil: hire?.undoUntil ?? card.undoUntil,
  });
  const extras = hireExtras(hire, name);

  const [pill, tone] = gone
    ? ["see Hedera for the outcome", "bg-side text-ink-3"]
    : canUndo
      ? ["can undo", "bg-saffron-soft text-saffron-ink"]
      : {
          paying: ["paying…", "bg-saffron-soft text-saffron-ink"],
          held: ["booking…", "bg-saffron-soft text-saffron-ink"],
          delivered: ["booked", "bg-ok-soft text-ok"],
          released: ["done · paid", "bg-ok-soft text-ok"],
          cancelled: ["undone · nothing paid", "bg-side text-ink-3"],
          refunded: ["refunded", "bg-side text-ink-3"],
          failed: ["didn't go through", "bg-bad-soft text-bad"],
          disputed: ["reported · fee frozen", "bg-bad-soft text-bad"],
        }[status];

  return (
    <section
      ref={root}
      aria-label={`Hired ${name}`}
      className="flex flex-col gap-3 rounded-2xl border border-line p-4 sm:p-[18px]"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] font-bold">{card.title}</span>
          <span className="text-xs text-muted">
            {name}'s fee <span className="font-mono">{fee}</span>, paid only when it's done
          </span>
        </span>
        <span className={`flex-none rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>
          {pill}
        </span>
      </div>
      <PaymentReceipt
        feeUnits={card.feeUnits}
        priceUnits={hire?.priceUnits ?? null}
        payTx={payTx}
        offerUrl={hire?.offerUrl ?? null}
        status={status}
        name={name}
      />
      <Timeline label="Progress" steps={steps} />
      {extras.length > 0 && <Timeline label="Along the way" steps={extras} />}
      {canUndo && (
        <button
          type="button"
          disabled={cancelling}
          onClick={undo}
          className="flex min-h-11 items-center justify-center gap-2 self-start rounded-xl border border-line-2 bg-white px-4 text-sm font-semibold text-bad disabled:opacity-50"
        >
          <UndoRing
            secs={secs}
            total={hire ? windowSecs(hire.createdAt, hire.undoUntil ?? card.undoUntil) : undefined}
          />
          {cancelling ? "Undoing…" : `Undo · ${clock(secs)} left`}
        </button>
      )}
      {hire?.canSimulateDrop && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line-2 px-3 py-2">
          <button
            type="button"
            onClick={simulateDrop}
            className="flex min-h-9 items-center rounded-lg border border-line-2 bg-white px-3 text-xs font-semibold"
          >
            Simulate a price drop (demo)
          </button>
          <span className="text-xs text-muted">
            {demo ?? "Sandbox prices don't move: this pretends the room got ₹800 cheaper."}
          </span>
        </div>
      )}
      {hire?.canReport && hire.reviewUntil && (
        <ReportProblem
          path={`/chats/${ctx.chatId}/hires/${card.hireId}`}
          reviewUntil={hire.reviewUntil}
          onReported={setHire}
        />
      )}
      {hire?.canCancelBooking && (
        <CancelBooking
          path={`/chats/${ctx.chatId}/hires/${card.hireId}`}
          agentName={name}
          onCancelled={setHire}
        />
      )}
      {(status === "delivered" || status === "released") && (
        <a
          href={`/receipts/${card.hireId}`}
          target="_blank"
          rel="noreferrer"
          className="self-start text-xs font-semibold text-teal underline underline-offset-2"
        >
          Receipt anyone can check
        </a>
      )}
      {(status === "delivered" || status === "released") && (
        <RateAgent path={`/chats/${ctx.chatId}/hires/${card.hireId}/rating`} agentName={name} />
      )}
      {error && <p className="text-xs text-bad">{error}</p>}
    </section>
  );
}

const DOT: Record<Step["state"], string> = {
  done: "bg-ok",
  now: "bg-saffron ring-4 ring-saffron/25 animate-pulse",
  todo: "border border-line-2 bg-white",
  bad: "bg-bad",
};

/** Steps as a timeline: a dot per step, joined by a line; the current one pulses. */
function Timeline({ label, steps }: { label: string; steps: Step[] }) {
  return (
    <ol aria-label={label} className="flex flex-col">
      {steps.map((s, i) => (
        <li key={s.id} className="relative flex gap-3 pb-2.5 last:pb-0">
          {i < steps.length - 1 && (
            <span aria-hidden className="absolute top-3.5 bottom-0 left-[4px] w-px bg-line-2" />
          )}
          <span
            aria-hidden
            className={`relative mt-1.5 size-[9px] flex-none rounded-full ${DOT[s.state]}`}
          />
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 text-[13px]">
            <span
              className={
                s.state === "todo"
                  ? "text-muted"
                  : s.state === "bad"
                    ? "font-semibold text-bad"
                    : s.state === "now"
                      ? "font-semibold"
                      : ""
              }
            >
              {s.state === "now" && <span className="sr-only">Now: </span>}
              {s.label}
            </span>
            {s.detail && <span className="text-xs text-muted">{s.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
