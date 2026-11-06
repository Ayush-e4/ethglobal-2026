"use client";

import { useState } from "react";
import { ApiError, api, type HireView } from "@/lib/api";

/**
 * Cancel a booking, after the undo window. The agent cancels it with the hotel or airline; its fee stays
 * paid, because it did book as promised. Asks once more first: this can't be undone.
 */
export function CancelBooking({
  path,
  agentName,
  onCancelled,
}: {
  path: string; // /chats/:id/hires/:hireId
  agentName: string;
  onCancelled: (h: HireView) => void;
}) {
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      onCancelled(await api<HireView>(`${path}/cancel-booking`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't cancel it. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!sure)
    return (
      <button
        type="button"
        onClick={() => setSure(true)}
        className="min-h-9 self-start rounded-lg border border-line-2 bg-white px-3 text-xs font-semibold text-bad"
      >
        Cancel this booking
      </button>
    );
  return (
    <div className="flex w-full flex-col gap-2 rounded-xl border border-bad/30 bg-bad-soft p-3 text-sm">
      <span className="font-semibold">Cancel the booking?</span>
      <span className="text-xs text-ink-3">
        {agentName} cancels it for you. Its fee stays paid: it booked as promised. This can't be
        undone.
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={cancel}
          className="min-h-9 rounded-lg bg-bad px-3 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Cancelling…" : "Yes, cancel it"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setSure(false)}
          className="min-h-9 px-2 text-xs text-ink-3"
        >
          Keep it
        </button>
      </div>
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}
