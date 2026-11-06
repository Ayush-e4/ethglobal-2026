"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, usdc, type WalletLimit } from "@/lib/api";
import { cancelled, withFaceId } from "@/lib/passkey";
import { CardSkeleton } from "../Skeleton";

const TONE: Record<WalletLimit["status"], string> = {
  active: "bg-ok-soft text-ok",
  expired: "bg-bubble text-ink-3",
  cancelled: "bg-bad-soft text-bad",
};
const until = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * What the concierge may spend from your wallet, one limit per agent per chat. Cancelling one
 * is a Face ID approval: your wallet revokes it on Hedera, and nothing more can be paid from it.
 */
export function Limits() {
  const [rows, setRows] = useState<WalletLimit[] | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api<WalletLimit[]>("/wallet/limits")
        .then(setRows)
        .catch(() => setError("Couldn't load your limits.")),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const cancel = async (l: WalletLimit) => {
    setWorking(l.id);
    setError(null);
    try {
      const path = `/wallet/limits/${l.id}/revoke`;
      await withFaceId(`${path}/face-id`, {}, path);
      await load();
    } catch (err) {
      setError(
        cancelled(err)
          ? "The Face ID prompt was closed."
          : err instanceof ApiError
            ? err.message
            : "Couldn't cancel the limit.",
      );
    } finally {
      setWorking(null);
    }
  };

  return (
    <section aria-label="Spending limits" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg font-bold">Spending limits</h2>
        <p className="text-sm text-ink-3">
          What the concierge may pay from your wallet. Hedera enforces each one; cancel any at once.
        </p>
      </div>
      {rows === null ? (
        <CardSkeleton label="Loading your limits" />
      ) : rows.length === 0 ? (
        <p className="rounded-2xl bg-side px-4 py-3 text-sm text-ink-3">
          None yet. The first time the concierge books an agent for you, you approve a limit for it
          with Face ID.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((l) => (
            <li
              key={l.id}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-line px-4 py-3"
            >
              <span className="flex min-w-0 flex-[1_1_220px] flex-col gap-0.5">
                <span className="text-sm font-semibold">
                  {l.agentName ?? "An agent"} ·{" "}
                  <Link
                    href={`/chat/${l.chatId}`}
                    className="font-normal text-teal hover:underline"
                  >
                    {l.chatTitle}
                  </Link>
                </span>
                <span className="text-xs text-muted">
                  {l.remainingUnits !== null
                    ? `${usdc(l.remainingUnits)} of ${usdc(l.budgetUnits)} USDC left`
                    : `${usdc(l.budgetUnits)} USDC`}
                  {l.status === "active" ? ` · until ${until(l.expiresAt)}` : ""}
                </span>
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[l.status]}`}
              >
                {l.status}
              </span>
              {l.status === "active" && (
                <button
                  type="button"
                  disabled={working !== null}
                  onClick={() => cancel(l)}
                  className="flex min-h-10 max-md:min-h-11 items-center rounded-xl border border-line-2 bg-white px-3.5 text-sm font-semibold text-bad disabled:opacity-50"
                >
                  {working === l.id ? "Waiting for Face ID…" : "Cancel"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
    </section>
  );
}
