"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type WorldCheck } from "@/lib/api";
import { WorldWaiting } from "../world/WorldWaiting";

interface RatingView {
  canRate: boolean;
  verified: boolean;
  rating: { score: number; status: "posting" | "posted" | "failed"; entity: string | null } | null;
}

/**
 * Rating the agent once the job is done: verified people only (World ID), one rating per person
 * per agent, posted to Arkiv where anyone can read it. A verified account rates at once; others
 * approve in the World ID app first. Rating again replaces the earlier one.
 */
export function RateAgent({ path, agentName }: { path: string; agentName: string }) {
  const [view, setView] = useState<RatingView | null>(null);
  const [check, setCheck] = useState<WorldCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<number | null>(null); // lit at once, while Arkiv confirms
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<RatingView>(path)
        .then(setView)
        .catch(() => {}),
    [path],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const waiting = check?.status === "waiting" && new Date(check.expiresAt) > new Date();
  const checkId = check?.id;
  useEffect(() => {
    if (!waiting || !checkId) return;
    const t = setInterval(
      () =>
        void api<{ check: WorldCheck }>(`/world/checks/${checkId}`)
          .then((r) => {
            setCheck(r.check);
            if (r.check.status === "verified") void load(); // the server posted it
          })
          .catch(() => {}),
      2500,
    );
    return () => clearInterval(t);
  }, [waiting, checkId, load]);

  if (!view?.canRate) return null;

  const rate = async (score: number) => {
    setBusy(true);
    setPicked(score);
    setNote(null);
    try {
      const r = await api<{ rating?: RatingView["rating"]; check?: WorldCheck; note?: string }>(
        path,
        { method: "POST", body: { score } },
      );
      if (r.check) setCheck(r.check);
      if (r.rating) setView({ ...view, rating: r.rating });
      if (r.note) setNote(`${r.note}.`);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Couldn't rate it. Try again.");
    } finally {
      setBusy(false);
      setPicked(null);
    }
  };

  const mine = view.rating;
  const lit = picked ?? mine?.score ?? 0;
  const declined = check?.status === "denied" || check?.status === "expired";
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-white p-3 text-sm">
      <span className="font-semibold">
        {mine ? `You rated ${agentName} ${mine.score}/5` : `How did ${agentName} do?`}
      </span>
      {waiting && check ? (
        <WorldWaiting check={check} />
      ) : (
        <fieldset className="m-0 flex gap-1 border-0 p-0" aria-label={`Rate ${agentName}`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              disabled={busy}
              onClick={() => rate(n)}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              className={`size-9 rounded-lg border text-lg leading-none disabled:opacity-50 ${
                n <= lit
                  ? "border-saffron bg-saffron-soft text-saffron-ink"
                  : "border-line-2 bg-white text-muted"
              }`}
            >
              ★
            </button>
          ))}
        </fieldset>
      )}
      <span className="text-xs text-muted">
        {busy && picked ? (
          "Posting your rating to Arkiv…"
        ) : mine?.status === "posted" && mine.entity ? (
          <>
            On Arkiv as a verified person's rating ·{" "}
            <a className="text-teal underline" href={mine.entity} target="_blank" rel="noreferrer">
              see it
            </a>
          </>
        ) : declined ? (
          "You didn't approve it in World ID, so no rating was posted."
        ) : view.verified ? (
          "Verified people only (World ID): one rating per person, posted on Arkiv."
        ) : (
          "Verified people only: you approve it in the World ID app first. One rating per person."
        )}
      </span>
      {note && <span className="text-xs text-bad">{note}</span>}
    </div>
  );
}
