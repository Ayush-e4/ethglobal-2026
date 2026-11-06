"use client";

import { useEffect, useState } from "react";
import { api, type Receipt, usdc } from "@/lib/api";

const ESCROW: Record<string, string> = {
  held: "Held: the agent isn't paid until it books",
  delivered: "Booked: paid to the agent when the review window ends",
  disputed: "Frozen: the guest reported a problem",
  released: "Paid to the agent",
  refunded: "Refunded to the guest",
  none: "Not on Hedera",
};

/** A booking's public proof, read live: what was booked, and where to check it yourself. */
export function ReceiptView({ id }: { id: string }) {
  const [r, setR] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Receipt>(`/receipts/${id}`)
      .then(setR)
      .catch(() => setError("There's no such receipt."));
  }, [id]);

  if (!r) return <p className="p-10 text-center text-muted">{error ?? "Loading the receipt…"}</p>;
  const rows: [string, string][] = [
    ["Booked by", `${r.agentName}, an agent on AgentNet`],
    [
      "Hired",
      new Date(r.bookedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
    ],
    ...(r.guest ? ([["Guest", r.guest]] as [string, string][]) : []),
    ...(r.bookingRef ? ([["Reference", r.bookingRef]] as [string, string][]) : []),
    ["Agent's fee", `${usdc(r.feeUnits)} USDC`],
    ["The fee now", r.escrow ? (ESCROW[r.escrow.state] ?? r.escrow.state) : "Not on Hedera"],
    ...(r.bookingCancelled
      ? ([["Cancelled", "By the guest, afterwards"]] as [string, string][])
      : []),
  ];

  return (
    <section className="flex w-full max-w-[560px] flex-col gap-5 rounded-2xl border border-line bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold tracking-wide text-muted uppercase">Receipt</span>
        <h1 className="text-xl font-bold">{r.title}</h1>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">Check it yourself</span>
        {r.links.map((l) => (
          <a
            key={l.url}
            href={l.url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-teal underline underline-offset-2"
          >
            {l.label}
          </a>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-muted">
        A test booking on Hedera testnet and a travel sandbox: nothing real was reserved. The guest
        shows as initials and the reference only in part.
      </p>
    </section>
  );
}
