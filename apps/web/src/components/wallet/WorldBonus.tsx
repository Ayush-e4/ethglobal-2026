"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api, hashscanTx, usdc, type WorldCheck, type WorldInfo } from "@/lib/api";
import { worldButton as button, WorldNote, WorldWaiting } from "../world/WorldWaiting";

/** Why the last check didn't pass (or what it passed into), in plain words. */
function ended(c: WorldCheck): string | null {
  if (c.status === "denied") return "You declined in the World ID app. Nothing was sent.";
  if (c.status === "expired") return "The check timed out. Nothing was sent.";
  if (c.status === "failed") return `World ID couldn't confirm it (${c.reason}). Nothing was sent.`;
  if (c.status === "mismatch")
    return c.reason === "this World ID is linked to another account"
      ? "That World ID is already used by another account: it's one bonus per person."
      : "That's a different World ID than the one on this account.";
  if (c.status === "verified" && c.reason) return `You're verified, but ${c.reason}.`;
  return null;
}

/**
 * The welcome bonus: prove you're a real person with World ID and get test USDC, once per
 * person. World ID tells us only that you're a unique person (no name, no email); our server
 * checks World's signed answer, and the bonus goes to your Face ID wallet from our sponsor.
 */
export function WorldBonus({ onBonus }: { onBonus: () => void }) {
  const [info, setInfo] = useState<WorldInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<WorldInfo>("/world")
        .then(setInfo)
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const check = info?.check;
  const waiting = check?.status === "waiting" && new Date(check.expiresAt) > new Date();
  const sending = info?.bonus?.status === "sending";
  useEffect(() => {
    if (!waiting && !sending) return;
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [waiting, sending, load]);
  const sent = info?.bonus?.status === "sent";
  useEffect(() => {
    if (sent) onBonus(); // the wallet's balance just went up
  }, [sent, onBonus]);

  if (!info?.available || !info.bonusUnits) return null;
  const amount = usdc(info.bonusUnits);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ check: WorldCheck }>("/world/bonus", { method: "POST" });
      setInfo({ ...info, check: r.check });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start World ID. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (info.bonus)
    return (
      <section
        aria-label="World ID"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-ok-soft px-4 py-3 text-sm"
      >
        <span className="font-semibold text-ok">✓ Verified person (World ID)</span>
        <span className="text-ink-3">
          {info.bonus.status === "sent" ? (
            <>
              +{usdc(info.bonus.units)} test USDC welcome bonus
              {info.bonus.tx && (
                <>
                  {" · "}
                  <a
                    className="font-medium text-teal underline"
                    href={hashscanTx(info.bonus.tx)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    see it on HashScan
                  </a>
                </>
              )}
            </>
          ) : sending ? (
            "Sending your bonus…"
          ) : (
            "The bonus didn't go through this time."
          )}
        </span>
      </section>
    );

  return (
    <section
      aria-label="World ID bonus"
      className="flex flex-col gap-3 rounded-2xl border border-warm-line bg-warm p-4 text-sm"
    >
      <div className="flex flex-col gap-1">
        <span className="text-base font-semibold">
          Prove you're a person, get +{amount} test USDC
        </span>
        <span className="leading-relaxed text-ink-3">
          World ID checks you're a real, unique person without telling us who you are: no name, no
          email. One bonus per person.
        </span>
      </div>

      {waiting && check ? (
        <WorldWaiting check={check} />
      ) : (
        <>
          {check && ended(check) && <p className="text-ink-2">{ended(check)}</p>}
          <button type="button" onClick={start} disabled={busy} className={`${button} self-start`}>
            {busy ? "Starting…" : info.verified ? "Get the bonus" : "Verify with World ID"}
          </button>
        </>
      )}
      <WorldNote />
      {error && <p className="text-bad">{error}</p>}
    </section>
  );
}
