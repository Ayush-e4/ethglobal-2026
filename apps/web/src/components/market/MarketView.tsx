"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type MarketAgentView, shortAddress, usdc, verifiedRating } from "@/lib/api";
import { CardSkeleton } from "../Skeleton";
import { operatorLine, ReviewBadge } from "./ReviewBadge";

/**
 * Every agent on the open market (Arkiv), and where each stands: only agents that pass our checks
 * are offered in chats. Anyone can look; listing one needs a World ID-verified account.
 */
export function MarketView() {
  const [agents, setAgents] = useState<MarketAgentView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<MarketAgentView[]>("/market/agents")
      .then((a) =>
        setAgents(
          [...a].sort(
            (x, y) =>
              Number(y.review?.status === "approved") - Number(x.review?.status === "approved") ||
              y.delivered - x.delivered,
          ),
        ),
      )
      .catch(() => setError("Couldn't load the market."));
  }, []);

  return (
    <div className="flex w-full max-w-[860px] flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-bold tracking-tight">Market</h1>
          <p className="max-w-[560px] text-[15px] leading-relaxed text-ink-3">
            Agents anyone can hire, listed on Arkiv. We check each one before it's offered (its
            quotes are signed, its fee is held in escrow with an undo and a review window), and
            again every hour. Reported problems stay on its record.
          </p>
        </div>
        <Link
          href="/agents/list"
          className="flex min-h-10 items-center rounded-xl bg-teal px-4 text-sm font-semibold text-white"
        >
          List your agent
        </Link>
      </div>
      {!agents ? (
        error ? (
          <p className="p-10 text-center text-muted">{error}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CardSkeleton label="Loading the market" />
            <CardSkeleton label="Loading the market" />
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {agents.map((a) => (
            <Link
              key={a.address}
              href={`/agents/${a.address}`}
              className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-4 hover:border-line-2"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="flex flex-col">
                  <span className="text-[15px] font-bold">{a.name}</span>
                  <span className="text-xs text-muted">
                    {a.skill} · fee <span className="font-mono">{usdc(a.feeUnits)} USDC</span> ·{" "}
                    <span className="font-mono">{shortAddress(a.address)}</span>
                  </span>
                </span>
                <ReviewBadge review={a.review} />
              </span>
              {a.service && (
                <span className="text-[13px] text-ink-2">
                  <span className="font-semibold">{a.service.model}.</span> {a.service.promise}
                </span>
              )}
              <span className="text-xs text-muted">
                {a.delivered} delivered · {a.disputes} reported
                {a.rating ? ` · ${verifiedRating(a.rating)}` : ""} · {operatorLine(a.review)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
