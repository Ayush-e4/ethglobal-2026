"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";

interface Request {
  app: string;
  returnsTo: string;
  expiresAt: string;
}

const CAN = [
  "Find agents on the market and read what they need",
  "Get free quotes from them",
  "Hire an agent you chose, paying its fee only within the spending limits you approve with Face ID",
  "See your bookings, and undo one in its undo window",
];
const CANT = [
  "Spend beyond your limits, or set a limit without your Face ID",
  "See your travellers' details (they go only to the agent you hire)",
];

/**
 * Says what's asking to connect and what it could do, then sends the user back to it with the
 * answer. Signed out: sign in first, then back here.
 */
export function ConnectApp() {
  const id = useSearchParams().get("req") ?? "";
  const router = useRouter();
  const [req, setReq] = useState<Request | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Request>(`/oauth/requests/${id}`)
      .then(setReq)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401)
          router.replace(`/login?next=${encodeURIComponent(`/connect?req=${id}`)}`);
        else setError(err instanceof ApiError ? err.message : "Couldn't load the request.");
      });
  }, [id, router]);

  const answer = async (allow: boolean) => {
    setBusy(true);
    try {
      const r = await api<{ redirect: string }>(`/oauth/requests/${id}/answer`, {
        method: "POST",
        body: { allow },
      });
      window.location.href = r.redirect;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send your answer. Try again.");
      setBusy(false);
    }
  };

  if (!req) return <p className="text-center text-muted">{error ?? "Loading…"}</p>;
  return (
    <section className="flex w-full max-w-[440px] flex-col gap-5 rounded-2xl border border-line p-5 sm:p-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[22px] font-bold tracking-tight">Connect {req.app} to Shikigami?</h1>
        <p className="text-sm text-ink-3">
          It will use Shikigami as you, and send you back to {req.returnsTo}.
        </p>
        <p className="rounded-xl border border-warm-line bg-warm px-3 py-2 text-xs text-saffron-ink">
          Any app can call itself &ldquo;{req.app}&rdquo;: Shikigami can&apos;t check the name. Only
          continue if you started connecting from <strong>{req.returnsTo}</strong> yourself.
        </p>
      </div>
      <div className="flex flex-col gap-2 text-sm">
        <span className="font-semibold">It can</span>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-2">
          {CAN.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <span className="mt-1 font-semibold">It can't</span>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-2">
          {CANT.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted">
        What it does shows in a chat here too. Disconnect any time in Wallet → Connected apps.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => answer(true)}
          className="flex h-12 flex-1 items-center justify-center rounded-xl bg-teal font-semibold text-white disabled:opacity-60"
        >
          Connect
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => answer(false)}
          className="h-12 rounded-xl border border-line-2 bg-white px-5 font-semibold"
        >
          No
        </button>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </section>
  );
}
