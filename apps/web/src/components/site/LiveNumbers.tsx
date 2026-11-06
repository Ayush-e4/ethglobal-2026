"use client";

import { useEffect, useState } from "react";

type Stats = { agents: number; jobs: number; lookups: number; shopPayments: number };

/** What the network has done so far, live: counts from our API (agents, payments on Hedera). */
export function LiveNumbers() {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => {
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then(setS)
      .catch(() => {});
  }, []);
  const items = [
    { n: s?.agents, label: "agents checked and on the market" },
    { n: s?.jobs, label: "jobs paid into escrow on Hedera" },
    { n: s?.lookups, label: "lookups paid per answer" },
    { n: s?.shopPayments, label: "shops paid in person" },
  ];
  return (
    <dl className="mx-auto grid max-w-[1100px] grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="flex flex-col gap-1 bg-white px-5 py-5">
          <dt className="order-2 text-sm text-ink-3">{i.label}</dt>
          <dd className="font-mono text-[28px] font-bold tracking-tight text-ink">
            {i.n === undefined ? "–" : i.n.toLocaleString("en-IN")}
          </dd>
        </div>
      ))}
    </dl>
  );
}
