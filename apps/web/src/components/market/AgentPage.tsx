"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type AgentPageView, api, usdc, verifiedRating } from "@/lib/api";
import { operatorLine, ReviewBadge } from "./ReviewBadge";

const CHECK_NAMES: Record<string, string> = {
  name: "Its name isn't another agent's",
  secure: "Served over https",
  reachable: "Up and answering",
  quotes: "Quotes a sample job",
  signed: "Offers signed on Arkiv, at its listed fee",
  terms: "Fee held in escrow, with undo and review windows",
  record: "Not too many reported problems",
};
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

/** One agent, public: what it does, its record, and each of our checks with how it went. */
export function AgentPage({ address }: { address: string }) {
  const [a, setA] = useState<AgentPageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<AgentPageView>(`/market/agents/${address}`)
      .then(setA)
      .catch(() => setError("There's no such agent on the market."));
  }, [address]);
  if (!a) return <p className="p-10 text-center text-muted">{error ?? "Loading…"}</p>;

  const fields = a.form ? Object.entries(a.form.properties) : [];
  return (
    <div className="flex w-full max-w-[680px] flex-col gap-5">
      <Link href="/agents" className="text-sm text-teal">
        ← Market
      </Link>
      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[24px] font-bold tracking-tight">{a.name}</h1>
            <span className="text-sm text-muted">
              {a.title ?? a.skill} · fee <span className="font-mono">{usdc(a.feeUnits)} USDC</span>,
              paid only when it's done
            </span>
          </div>
          <ReviewBadge review={a.review} />
        </div>
        <p className="text-[15px] leading-relaxed text-ink-2">{a.description}</p>
        {a.service && (
          <p className="rounded-xl bg-side p-3 text-sm text-ink-2">
            <span className="font-semibold">{a.service.model}:</span> {a.service.promise}
            <span className="mt-1 block text-xs text-muted">
              Its own words: a claim, not our promise.
            </span>
          </p>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-sm">
          <dt className="text-muted">Record</dt>
          <dd>
            {a.delivered} jobs delivered · {a.disputes} reported by buyers
          </dd>
          <dt className="text-muted">Ratings</dt>
          <dd>{a.rating ? verifiedRating(a.rating) : "None from verified people yet"}</dd>
          <dt className="text-muted">Who runs it</dt>
          <dd>{operatorLine(a.review)}</dd>
          <dt className="text-muted">Gets of a traveller</dt>
          <dd>
            Name, email, phone
            {a.guestFields.includes("bornOn") ? ", date of birth" : ""}
            {a.guestFields.includes("gender") ? ", gender" : ""}
            <span className="text-xs text-muted"> (only for its own bookings)</span>
          </dd>
          <dt className="text-muted">Its address</dt>
          <dd className="font-mono text-[13px] break-all">{a.address}</dd>
          <dt className="text-muted">Its server</dt>
          <dd className="font-mono text-[13px]">{a.endpointHost}</dd>
          {fields.length > 0 && (
            <>
              <dt className="text-muted">Needs</dt>
              <dd>{fields.map(([k]) => k).join(", ")}</dd>
            </>
          )}
        </dl>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[17px] font-bold">Our checks</h2>
          <span className="text-xs text-muted">
            {a.review
              ? `Last checked ${when(a.review.checkedAt)}. Approved agents are checked again every hour; a second failure in a row, or too many reported problems, hides it.`
              : "Not reviewed yet: it isn't offered in chats."}
          </span>
        </div>
        <ul className="flex flex-col gap-2">
          {(a.review?.checks ?? []).map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-sm">
              <span aria-hidden className={`mt-0.5 font-bold ${c.ok ? "text-ok" : "text-bad"}`}>
                {c.ok ? "✓" : "✗"}
              </span>
              <span className="flex flex-col">
                <span className="font-medium">{CHECK_NAMES[c.id] ?? c.id}</span>
                <span className="text-xs text-muted">{c.note}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs leading-relaxed text-muted">
          Even an approved agent can't take more than its fee: it's held in escrow on Hedera, paid
          only after the job and a review window, within limits each buyer approves with Face ID.
        </p>
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-5 text-sm sm:p-6">
        <h2 className="text-[17px] font-bold">On-chain identity (ERC-8004)</h2>
        {a.erc8004 ? (
          <>
            <span className="text-ink-2">
              Agent{" "}
              <a
                href={a.erc8004.url}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-teal underline"
              >
                #{a.erc8004.agentId}
              </a>{" "}
              in the ERC-8004 identity registry on Hedera, owned by its own key: any app that reads
              ERC-8004 can find it, and what it does.
            </span>
            <span className="text-ink-2">
              {a.erc8004.reputation?.count
                ? `Reputation there: ${a.erc8004.reputation.count} rating${a.erc8004.reputation.count === 1 ? "" : "s"} from verified people, averaging ${a.erc8004.reputation.average.toFixed(1)}★, given by AgentNet's concierge (the client that hired it).`
                : "No ratings there yet: each verified person's rating goes there too, given by AgentNet's concierge (the client that hired it)."}
            </span>
          </>
        ) : (
          <span className="text-muted">
            Not registered in ERC-8004, or its card doesn't match the registry.
          </span>
        )}
      </section>

      {a.links.length > 0 && (
        <section className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">Check it yourself</span>
          {a.links.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="text-teal underline underline-offset-2"
            >
              {l.label}
            </a>
          ))}
        </section>
      )}
    </div>
  );
}
