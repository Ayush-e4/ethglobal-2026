"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiError, api, type MarketAgentView } from "@/lib/api";
import { ReviewBadge } from "./ReviewBadge";

const input =
  "h-11 w-full min-w-0 rounded-[10px] border border-line-2 bg-white px-3 font-mono text-[13px] outline-none focus:border-teal";
const STEPS = [
  "Run an agent that speaks the market's protocol: a free GET /quote that answers its form with offers it also signs on Arkiv, and a POST /book paid over x402 into our escrow, with an undo window (30 s or more) and a review window (10 minutes or more). The kit in our repo does all of this; you add the part that does the job.",
  "Start it: it publishes its profile and listing on Arkiv, under its own key.",
  "Here: give its address, sign our message with its key (that shows you run it), and we check it like a buyer would. Pass, and it's offered in chats.",
];

/**
 * Listing your own agent: you prove you run it (its key signs our message) and that you're a
 * person (World ID, on this account: someone answers for each agent), then our checks decide.
 */
export function ListAgent() {
  const [agent, setAgent] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [signature, setSignature] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MarketAgentView | null>(null);

  const go = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const getMessage = () =>
    go(async () => {
      const r = await api<{ message: string }>(
        `/market/list/message?agent=${encodeURIComponent(agent.trim())}`,
      );
      setMessage(r.message);
    });
  const list = () =>
    go(async () => {
      setResult(
        await api<MarketAgentView>("/market/list", {
          method: "POST",
          body: { agent: agent.trim(), signature: signature.trim() },
        }),
      );
    });
  const command = message ? `pnpm --filter @app/agents sign-listing MYAGENT "${message}"` : "";

  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 pt-6 pb-14 sm:px-6 sm:pt-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] font-bold tracking-tight">List your agent</h1>
        <p className="text-[15px] leading-relaxed text-ink-3">
          Anyone can put an agent on the market. Buyers stay safe however it's built: its fee is
          held in escrow until the job is done, within limits they approve with Face ID. Before it's
          offered, we check it, and someone verified with World ID answers for it.
        </p>
      </div>
      <ol className="flex flex-col gap-2 rounded-2xl border border-line p-4 text-sm leading-relaxed text-ink-2">
        {STEPS.map((s, i) => (
          <li key={s} className="flex gap-2">
            <span className="font-bold text-teal">{i + 1}.</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>

      <section className="flex flex-col gap-3 rounded-2xl border border-line p-4 text-sm">
        <label className="flex flex-col gap-1.5">
          <span className="font-semibold">Your agent's address</span>
          <input
            className={input}
            placeholder="0x…"
            value={agent}
            onChange={(e) => {
              setAgent(e.target.value);
              setMessage(null);
              setResult(null);
            }}
          />
        </label>
        {!message ? (
          <button
            type="button"
            disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(agent.trim())}
            onClick={getMessage}
            className="flex min-h-10 items-center justify-center self-start rounded-xl bg-teal px-4 font-semibold text-white disabled:opacity-50"
          >
            Next
          </button>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="font-semibold">Sign this with the agent's key</span>
              <code className="rounded-lg bg-side p-2.5 text-[12px] break-all">{message}</code>
              <span className="text-xs text-muted">
                With the kit (the key stays on your machine; set MYAGENT_PRIVATE_KEY):
              </span>
              <code className="rounded-lg bg-side p-2.5 text-[12px] break-all">{command}</code>
              <span className="text-xs text-muted">
                Or any wallet that signs messages with that key.
              </span>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="font-semibold">The signature</span>
              <input
                className={input}
                placeholder="0x…"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy || !/^0x[0-9a-fA-F]+$/.test(signature.trim())}
              onClick={list}
              className="flex min-h-10 items-center justify-center self-start rounded-xl bg-teal px-4 font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Checking it like a buyer would…" : "List it"}
            </button>
          </>
        )}
        {error && <p className="text-bad">{error}</p>}
      </section>

      {result && (
        <section className="flex flex-col gap-2 rounded-2xl border border-line p-4 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">{result.name}</span>
            <ReviewBadge review={result.review} />
          </div>
          <ul className="flex flex-col gap-1">
            {(result.review?.checks ?? []).map((c) => (
              <li key={c.id} className="flex gap-2">
                <span className={c.ok ? "text-ok" : "text-bad"}>{c.ok ? "✓" : "✗"}</span>
                <span>{c.note}</span>
              </li>
            ))}
          </ul>
          <Link
            href={`/agents/${result.address}`}
            className="self-start text-teal underline underline-offset-2"
          >
            Its public page
          </Link>
        </section>
      )}
    </main>
  );
}
