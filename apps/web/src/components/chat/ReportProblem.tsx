"use client";

import { useState } from "react";
import { ApiError, api, type HireView } from "@/lib/api";

const REASONS = [
  ["not_found", "The hotel can't find my booking"],
  ["wrong_details", "Wrong dates, room or guest"],
  ["other", "Something else"],
] as const;

/**
 * Report a problem with a booking, while its review window is open: the fee freezes on Hedera
 * (the agent isn't paid while it sorts it out), the report goes on the agent's public record, and
 * our agents settle it by cancelling the booking and refunding the fee.
 */
export function ReportProblem({
  path,
  reviewUntil,
  onReported,
}: {
  path: string; // /chats/:id/hires/:hireId
  reviewUntil: string;
  onReported: (h: HireView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const until = new Date(reviewUntil).toLocaleTimeString("en-IN", { timeStyle: "short" });

  const report = async (reason: string) => {
    setBusy(true);
    setError(null);
    try {
      onReported(await api<HireView>(`${path}/dispute`, { method: "POST", body: { reason } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't report it. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-xs font-semibold text-ink-3 underline underline-offset-2"
      >
        Something wrong? Report a problem (until {until})
      </button>
    );
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-bad/30 bg-bad-soft p-3 text-sm">
      <span className="font-semibold">What's wrong?</span>
      <span className="text-xs text-ink-3">
        The fee freezes on Hedera, so the agent isn't paid while it sorts this out. Your report goes
        on its public record.
      </span>
      <div className="flex flex-wrap gap-2">
        {REASONS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            disabled={busy}
            onClick={() => report(id)}
            className="min-h-9 rounded-lg border border-line-2 bg-white px-3 text-xs font-semibold disabled:opacity-50"
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-9 px-2 text-xs text-ink-3"
        >
          Cancel
        </button>
      </div>
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}
