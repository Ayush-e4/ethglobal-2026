"use client";

import { IDKitRequestWidget, type IDKitResult, orbLegacy, type RpContext } from "@worldcoin/idkit";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, hashscanTx } from "@/lib/api";

interface Drop {
  id: string;
  title: string;
  detail: string;
  total: number;
  left: number;
  endsAt: string;
  mine: { status: "claimed" | "applied" | "paid" | "failed"; payTx: string | null } | null;
}
interface Start {
  app_id: `app_${string}`;
  action: string;
  environment: "production" | "staging";
  signal: string;
  rp_context: RpContext;
}

const MINE: Record<NonNullable<Drop["mine"]>["status"], string> = {
  claimed: "Claimed: your next booking's fee comes back once its agent is paid.",
  applied: "Being paid back for your latest booking…",
  paid: "Paid back to your wallet.",
  failed: "The payback didn't go through; we'll look at it.",
};

/**
 * Deal drops: a few of something good, one per person. You prove you're a person with World ID
 * (IDKit; nothing about who you are is shared), and a World ID can claim each drop once, on one
 * account, however many accounts its owner makes.
 */
export function DealDrop() {
  const [drops, setDrops] = useState<Drop[] | null>(null);
  const [start, setStart] = useState<{ id: string; s: Start } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api<{ available: boolean; drops: Drop[] }>("/deals")
        .then((r) => setDrops(r.available ? r.drops : []))
        .catch(() => setDrops([])),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!drops?.length) return null;

  const begin = async (id: string) => {
    setNote(null);
    try {
      setStart({ id, s: await api<Start>(`/deals/${id}/start`, { method: "POST" }) });
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Couldn't start. Try again.");
    }
  };
  // Checked on our server (with World) before the widget says it worked.
  const claim = async (result: IDKitResult) => {
    if (!start) throw new Error("no request");
    try {
      await api(`/deals/${start.id}/claim`, { method: "POST", body: result });
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Couldn't claim it.");
      throw err;
    }
  };

  return (
    <section
      aria-label="Deal drops"
      className="flex flex-col gap-3 rounded-2xl border border-warm-line bg-warm p-4 text-sm"
    >
      {drops.map((d) => (
        <div key={d.id} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold tracking-wide text-saffron-ink uppercase">
                Deal drop · one per person
              </span>
              <span className="text-[15px] font-bold">{d.title}</span>
            </span>
            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold">
              {d.left} of {d.total} left
            </span>
          </div>
          <span className="text-ink-3">{d.detail}</span>
          {d.mine ? (
            <span className="font-medium text-ok">
              {MINE[d.mine.status]}{" "}
              {d.mine.payTx && (
                <a
                  className="text-teal underline"
                  href={hashscanTx(d.mine.payTx)}
                  target="_blank"
                  rel="noreferrer"
                >
                  See it on HashScan
                </a>
              )}
            </span>
          ) : (
            <button
              type="button"
              disabled={d.left === 0}
              onClick={() => void begin(d.id)}
              className="flex min-h-10 items-center self-start rounded-xl bg-ink px-4 font-semibold text-white disabled:opacity-50"
            >
              {d.left === 0 ? "All claimed" : "Claim with World ID"}
            </button>
          )}
        </div>
      ))}
      <span className="text-xs text-muted">
        World ID proves you're a unique person without saying who you are: each person gets one,
        however many accounts they make.
      </span>
      {note && <span className="text-bad">{note}</span>}
      {start && (
        <IDKitRequestWidget
          open
          onOpenChange={(open) => !open && setStart(null)}
          app_id={start.s.app_id}
          action={start.s.action}
          rp_context={start.s.rp_context}
          environment={start.s.environment}
          allow_legacy_proofs
          preset={orbLegacy({ signal: start.s.signal })}
          handleVerify={claim}
          onSuccess={() => {
            setStart(null);
            setNote(null);
            void load();
          }}
          onError={(code) => {
            if (code !== "failed_by_host_app")
              setNote("World ID didn't finish. Nothing was claimed.");
          }}
        />
      )}
    </section>
  );
}
