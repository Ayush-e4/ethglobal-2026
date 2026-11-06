"use client";

import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";

const small =
  "h-9 max-md:h-11 rounded-[10px] border border-line-2 bg-white px-3 text-[13px] font-semibold";

/**
 * Your email: account notices (like an app being connected) and a copy of every booking email,
 * whoever the booking is for. "Send a test" shows exactly what the email service said.
 */
export function EmailSettings() {
  const [state, setState] = useState<{ email: string | null; available: boolean } | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ email: string | null; available: boolean }>("/account/email")
      .then((r) => {
        setState(r);
        setDraft(r.email ?? "");
      })
      .catch(() => {});
  }, []);
  if (!state?.available) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
    } catch (err) {
      setNote({
        ok: false,
        text: err instanceof ApiError ? err.message : "That didn't work. Try again.",
      });
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      const r = await api<{ email: string | null }>("/account/email", {
        method: "PUT",
        body: { email: draft.trim() || null },
      });
      setState({ ...state, email: r.email });
      setNote({ ok: true, text: r.email ? "Saved." : "Removed." });
    });
  const test = () =>
    run(async () => {
      const r = await api<{ sent: boolean; error?: string }>("/account/email/test", {
        method: "POST",
      });
      setNote(
        r.sent
          ? { ok: true, text: `Sent to ${state.email}: check your inbox (and spam).` }
          : { ok: false, text: `Not sent: ${r.error}` },
      );
    });
  const changed = draft.trim().toLowerCase() !== (state.email ?? "");

  return (
    <section
      aria-label="Email"
      className="flex flex-col gap-3 rounded-2xl border border-line p-4 text-sm"
    >
      <div className="flex flex-col gap-1">
        <span className="font-semibold">Email</span>
        <span className="text-ink-3">
          Account notices, and a copy of every booking email, whoever it's for.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-9 max-md:h-11 min-w-0 flex-1 rounded-[10px] border border-line-2 bg-white px-3 text-sm outline-none focus:border-teal"
        />
        <button
          type="button"
          disabled={busy || !changed}
          onClick={save}
          className={`${small} disabled:opacity-50`}
        >
          Save
        </button>
        <button
          type="button"
          disabled={busy || !state.email || changed}
          onClick={test}
          className={`${small} disabled:opacity-50`}
        >
          Send a test
        </button>
      </div>
      {note && <span className={note.ok ? "text-ok" : "text-bad"}>{note.text}</span>}
    </section>
  );
}
