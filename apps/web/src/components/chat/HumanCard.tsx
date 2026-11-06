"use client";

import type { Card } from "@app/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, usdc, type WorldCheck } from "@/lib/api";
import { CheckIcon, ShieldIcon } from "../icons";
import { WorldNote, WorldWaiting, worldButton } from "../world/WorldWaiting";
import type { CardCtx } from "./Cards";

type HumanCardData = Extract<Card, { type: "human" }>;

/** Why the last check didn't pass, in plain words. */
function ended(c: WorldCheck): string | null {
  if (c.status === "denied") return "You declined in the World ID app. Nothing was paid.";
  if (c.status === "expired") return "The approval timed out. Nothing was paid.";
  if (c.status === "failed") return `World ID couldn't confirm it (${c.reason}). Nothing was paid.`;
  if (c.status === "mismatch")
    return "That's a different World ID than the one on this account. Nothing was paid.";
  return null;
}

/**
 * Before a larger payment: you approve this one booking in the World ID app, proving a real
 * person wants it (nothing about who you are). Our server checks World's answer; once it passes,
 * the booking carries on. Declined or timed out: nothing is paid.
 */
export function HumanCard({ card, ctx }: { card: HumanCardData; ctx: CardCtx }) {
  const [check, setCheck] = useState<WorldCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sawWaiting = useRef(false); // approved while this card watched: carry on by itself
  const replied = useRef(false);

  // Reopening the chat: the newest check for this quote.
  useEffect(() => {
    api<{ check: WorldCheck | null }>(`/chats/${ctx.chatId}/human-checks/${card.quoteKey}`)
      .then((r) => setCheck((c) => c ?? r.check))
      .catch(() => {});
  }, [ctx.chatId, card.quoteKey]);

  const waiting = check?.status === "waiting" && new Date(check.expiresAt) > new Date();
  const checkId = check?.id;
  useEffect(() => {
    if (!waiting || !checkId) return;
    sawWaiting.current = true;
    const t = setInterval(
      () =>
        void api<{ check: WorldCheck }>(`/world/checks/${checkId}`)
          .then((r) => setCheck(r.check))
          .catch(() => {}),
      2500,
    );
    return () => clearInterval(t);
  }, [waiting, checkId]);

  const carryOn = useCallback(() => {
    if (replied.current) return;
    replied.current = true;
    ctx.onReply(card.reply);
  }, [ctx, card.reply]);
  const passed = check?.status === "verified";
  useEffect(() => {
    if (passed && sawWaiting.current) carryOn();
  }, [passed, carryOn]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ check: WorldCheck }>(`/chats/${ctx.chatId}/human-checks`, {
        method: "POST",
        body: { quoteKey: card.quoteKey },
      });
      setCheck(r.check);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start World ID. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Approve with World ID"
      className="flex flex-col gap-3.5 rounded-2xl border border-warm-line bg-warm p-4 sm:p-[18px]"
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="flex size-[30px] flex-none items-center justify-center rounded-full border border-warm-line bg-saffron-soft text-saffron-ink"
        >
          <ShieldIcon size={16} />
        </span>
        <span className="text-[15px] font-bold">Confirm it's you with World ID</span>
      </div>
      <p className="text-sm leading-relaxed text-[#5C3A00]">
        This booking puts <strong className="font-mono">{usdc(card.feeUnits)} USDC</strong> into
        escrow (<strong>{card.agentName}</strong>&apos;s fee plus the trip price), a larger payment,
        so a real person approves it first, in the World ID app. It proves you're a person, nothing
        about who you are, and approves one payment to {card.agentName} in this chat, for 10
        minutes.
      </p>
      {passed ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="status" className="flex items-center gap-2 text-sm font-semibold text-ok">
            <CheckIcon size={16} /> Approved with World ID
          </p>
          {!check?.used && !sawWaiting.current && (
            <button type="button" onClick={carryOn} disabled={ctx.busy} className={worldButton}>
              Book it now
            </button>
          )}
        </div>
      ) : waiting && check ? (
        <WorldWaiting check={check} />
      ) : (
        <>
          {check && ended(check) && <p className="text-sm text-ink-2">{ended(check)}</p>}
          <button
            type="button"
            onClick={start}
            disabled={busy || ctx.busy}
            className={`${worldButton} self-start`}
          >
            {busy ? "Starting…" : check ? "Try again" : "Approve with World ID"}
          </button>
        </>
      )}
      <WorldNote />
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
    </section>
  );
}
