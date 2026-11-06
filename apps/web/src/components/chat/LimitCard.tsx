"use client";

import type { Card } from "@app/shared";
import { useEffect, useState } from "react";
import { ApiError, api, usdc } from "@/lib/api";
import { cancelled, withFaceId } from "@/lib/passkey";
import { CheckIcon, ShieldIcon } from "../icons";
import type { CardCtx } from "./Cards";

type LimitCardData = Extract<Card, { type: "limit" }>;
type Live = { payee: string; expiresAt: string };

/**
 * Before the concierge pays an agent from your own wallet: a spending limit for that agent in
 * this chat, approved with Face ID. Hedera enforces it. Once approved, the booking carries on.
 */
export function LimitCard({ card, ctx }: { card: LimitCardData; ctx: CardCtx }) {
  const [state, setState] = useState<"idle" | "working" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  // Reopening the chat: a live limit for this agent means this card was already approved.
  useEffect(() => {
    let stop = false;
    api<Live[]>(`/chats/${ctx.chatId}/limits`)
      .then((all) => {
        const covered = all.some((l) => l.payee.toLowerCase() === card.payee.toLowerCase());
        if (covered && !stop) setState((s) => (s === "idle" ? "done" : s));
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [ctx.chatId, card.payee]);

  const approve = async () => {
    setState("working");
    setError(null);
    try {
      const path = `/chats/${ctx.chatId}/limits`;
      await withFaceId(`${path}/face-id`, { payee: card.payee }, path);
      setState("done");
      ctx.onReply(card.reply);
    } catch (err) {
      setState("idle");
      setError(
        cancelled(err)
          ? "The Face ID prompt was closed. Try again when you're ready."
          : err instanceof ApiError
            ? err.message
            : "Couldn't set the limit. Try again.",
      );
    }
  };

  return (
    <section
      aria-label="Approve a spending limit"
      className="flex flex-col gap-3.5 rounded-2xl border border-warm-line bg-warm p-4 sm:p-[18px]"
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="flex size-[30px] flex-none items-center justify-center rounded-full border border-warm-line bg-saffron-soft text-saffron-ink"
        >
          <ShieldIcon size={16} />
        </span>
        <span className="text-[15px] font-bold">Let the concierge pay {card.agentName}</span>
      </div>
      <p className="text-sm leading-relaxed text-[#5C3A00]">
        Up to <strong className="font-mono">{usdc(card.budgetUnits)} USDC</strong> in fees from your
        wallet, at most <span className="font-mono">{usdc(card.capUnits)}</span> a payment, only to{" "}
        <strong>{card.agentName}</strong>, for {card.hours} hours. Hedera enforces it: nobody can
        spend past it, and you can still undo each payment during its window.
      </p>
      {state === "done" ? (
        <p role="status" className="flex items-center gap-2 text-sm font-semibold text-ok">
          <CheckIcon size={16} /> Limit set on Hedera
        </p>
      ) : (
        <button
          type="button"
          onClick={approve}
          disabled={state === "working" || ctx.busy}
          className="flex min-h-11 items-center justify-center self-start rounded-xl bg-teal px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {state === "working" ? "Waiting for Face ID…" : "Approve with Face ID"}
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
    </section>
  );
}
