"use client";

import { useCallback, useEffect, useState } from "react";

type State = { ok: boolean | null; ms?: number; note?: string };
type Check = { id: string; name: string; what: string; run: () => Promise<string | undefined> };

const MIRROR = "https://testnet.mirrornode.hedera.com/api/v1/blocks?limit=1";
const AGENTS = [
  { id: "staywise", name: "StayWise", what: "Books hotel rooms (LiteAPI sandbox)" },
  { id: "priceguard", name: "PriceGuard", what: "Watches a booked room and rebooks if it drops" },
  { id: "skyhop", name: "SkyHop", what: "Books flights (Duffel test mode)" },
  { id: "bankcheck", name: "Bank Check", what: "Answers IFSC lookups, paid per answer" },
];

async function get(url: string): Promise<Response> {
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}

const CHECKS: Check[] = [
  {
    id: "api",
    name: "Shikigami API",
    what: "Sign-in, chats, payments and the concierge",
    run: async () => {
      await get("/api/health");
      return undefined;
    },
  },
  {
    id: "arkiv",
    name: "Market on Arkiv",
    what: "Agents, quotes, receipts and ratings, read from Arkiv",
    run: async () => {
      const list = (await (await get("/api/market/agents")).json()) as unknown[];
      return `${list.length} listings read`;
    },
  },
  ...AGENTS.map((a) => ({
    ...a,
    run: async () => {
      await get(`/a/${a.id}/health`);
      return undefined;
    },
  })),
  {
    id: "hedera",
    name: "Hedera testnet",
    what: "Escrow, undo and payouts settle here",
    run: async () => {
      const j = (await (await get(MIRROR)).json()) as {
        blocks: { number: number; timestamp: { to: string } }[];
      };
      const b = j.blocks[0];
      if (!b) throw new Error("no blocks");
      const age = Math.max(0, Math.round(Date.now() / 1000 - Number(b.timestamp.to)));
      if (age > 120) throw new Error(`last block ${age}s ago`);
      return `block ${b.number}, ${age}s ago`;
    },
  },
];

/** Every part of the product, checked from your browser right now (and every 30 seconds). */
export function StatusChecks() {
  const [states, setStates] = useState<Record<string, State>>({});
  const [at, setAt] = useState<Date | null>(null);

  const runAll = useCallback(() => {
    setStates(Object.fromEntries(CHECKS.map((c) => [c.id, { ok: null }])));
    for (const c of CHECKS) {
      const t0 = performance.now();
      c.run()
        .then((note) => ({ ok: true, note }))
        .catch((e: unknown) => ({ ok: false, note: e instanceof Error ? e.message : "failed" }))
        .then((s) => {
          const ms = Math.round(performance.now() - t0);
          setStates((prev) => ({ ...prev, [c.id]: { ...s, ms } }));
        });
    }
    setAt(new Date());
  }, []);

  useEffect(() => {
    runAll();
    const t = setInterval(runAll, 30_000);
    return () => clearInterval(t);
  }, [runAll]);

  const done = CHECKS.map((c) => states[c.id]).filter((s) => s && s.ok !== null);
  const down = done.filter((s) => s?.ok === false).length;
  const summary =
    done.length < CHECKS.length
      ? { text: "Checking…", cls: "border-line bg-side text-ink-3" }
      : down === 0
        ? { text: "Everything is working", cls: "border-ok/30 bg-ok-soft text-ok" }
        : {
            text: `${down} of ${CHECKS.length} not responding`,
            cls: "border-bad/30 bg-bad-soft text-bad",
          };

  return (
    <div className="flex flex-col gap-4">
      <div
        className={`flex items-center justify-between gap-3 rounded-2xl border px-5 py-4 ${summary.cls}`}
      >
        <span className="text-lg font-semibold">{summary.text}</span>
        <button
          type="button"
          onClick={runAll}
          className="min-h-10 rounded-full border border-line bg-white px-4 text-sm font-semibold text-ink"
        >
          Check again
        </button>
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {CHECKS.map((c) => {
          const s = states[c.id];
          return (
            <li key={c.id} className="flex items-center gap-4 bg-white px-5 py-4">
              <Dot ok={s?.ok ?? null} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{c.name}</span>
                <span className="text-sm text-ink-3">{c.what}</span>
                {s?.note && <span className="text-xs text-muted">{s.note}</span>}
              </span>
              <span className="flex flex-none flex-col items-end text-right text-sm">
                <span className={s?.ok === false ? "font-semibold text-bad" : "text-ink-2"}>
                  {s?.ok === null || !s ? "checking" : s.ok ? "up" : "down"}
                </span>
                {s?.ms !== undefined && <span className="text-xs text-muted">{s.ms} ms</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {at && (
        <p className="text-xs text-muted">
          Checked from your browser at {at.toLocaleTimeString("en-IN")}; again every 30 seconds.
        </p>
      )}
    </div>
  );
}

function Dot({ ok }: { ok: boolean | null }) {
  const cls = ok === null ? "bg-line-2 animate-pulse" : ok ? "bg-ok" : "bg-bad";
  return <span aria-hidden className={`size-3 flex-none rounded-full ${cls}`} />;
}
