"use client";

import type { Card } from "@app/shared";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, cardLine, type HireView, hashscanTx, rupeesOf, usdc } from "@/lib/api";
import { celebrate } from "@/lib/native/celebrate";
import { haptic } from "@/lib/native/haptics";
import { UndoIcon } from "../icons";
import { CancelBooking } from "../trips/CancelBooking";
import type { CardCtx } from "./Cards";
import { RateAgent } from "./RateAgent";
import { ReportProblem } from "./ReportProblem";

type HireCardData = Extract<Card, { type: "hire" }>;
type Status = HireView["status"];
type Step = { id: string; label: string; done: boolean; tx?: string | null };

const FINAL: Status[] = ["cancelled", "released", "refunded", "failed"];
const left = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000));
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

  // The trip price rides in the same escrow as the fee (testnet scale), so say both.
  const what = hire?.priceUnits ? `${rupeesOf(hire.priceUnits)} + ${fee} fee` : `${fee} fee`;
  const steps: Step[] = [
    {
      id: "held",
      label:
        status === "released"
          ? `${what} held on Hedera until it was done`
          : FINAL.includes(status)
            ? `${what} was held on Hedera`
            : `${what} held on Hedera, not paid yet`,
      tx: card.payTx || hire?.payTx,
      done: true,
    },
  ];
  if (status === "cancelled")
    steps.push({
      id: "end",
      label: "Undone: nothing booked, the fee is back on your limit",
      done: true,
    });
  else if (status === "refunded")
    steps.push({
      id: "end",
      label: hire?.note?.toLowerCase().includes("report")
        ? `${name} accepted your report and refunded the fee`
        : `${name} couldn't book it and refunded the fee`,
      done: true,
    });
  else if (status === "failed")
    steps.push({ id: "end", label: hire?.note ?? "It didn't go through", done: false });
  else if (status === "disputed")
    steps.push(
      { id: "book", label: `Booked · reference ${hire?.bookingRef ?? "pending"}`, done: true },
      {
        id: "end",
        label: `You reported a problem: the fee is frozen on Hedera while ${name} sorts it out`,
        done: false,
      },
    );
  else {
    steps.push(
      status === "held"
        ? {
            id: "book",
            label: canUndo
              ? `${name} books it when the undo window ends`
              : `${name} is booking it…`,
            done: false,
          }
        : { id: "book", label: `Booked · reference ${hire?.bookingRef ?? "pending"}`, done: true },
      status === "released"
        ? { id: "pay", label: `Hedera paid ${name} the fee`, done: true }
        : { id: "pay", label: `Hedera pays ${name} when the review window ends`, done: false },
    );
  }

  if (hire?.card)
    steps.push({
      id: "card",
      label: `${name} paid with a one-time card (simulated) ${cardLine(hire.card)}`,
      done: hire.card.status !== "authorized",
    });
  if (hire?.bookingCancelledAt)
    steps.push({ id: "cancelled", label: "You cancelled the booking afterwards", done: true });
  if (hire?.watchNote)
    steps.push({ id: "watch", label: `${name}: ${hire.watchNote}`, done: !hire.watching });

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
      <ol aria-label="Progress" className="flex flex-col gap-1.5">
        {steps.map((s) => (
          <li key={s.id} className="flex items-start gap-2 text-[13px]">
            <span
              aria-hidden
              className={`mt-1.5 size-2 flex-none rounded-full ${s.done ? "bg-ok" : "border border-line-2 bg-white"}`}
            />
            {s.tx ? (
              <a className="text-teal" href={hashscanTx(s.tx)} target="_blank" rel="noreferrer">
                {s.label}
              </a>
            ) : (
              <span className={s.done ? "" : "text-muted"}>{s.label}</span>
            )}
          </li>
        ))}
      </ol>
      {canUndo && (
        <button
          type="button"
          disabled={cancelling}
          onClick={undo}
          className="flex min-h-11 items-center justify-center gap-2 self-start rounded-xl border border-line-2 bg-white px-4 text-sm font-semibold text-bad disabled:opacity-50"
        >
          <UndoIcon size={16} />
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
