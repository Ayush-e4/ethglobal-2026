"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { realName, useSession } from "@/lib/session";

/** Your name on the account card: shown, or edited in place (a passkey account only). */
export function NameField() {
  const { me, setName } = useSession();
  const current = realName(me?.displayName);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  if (me.isDemo) return <span className="truncate text-lg font-semibold">Demo</span>;

  if (!editing)
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-lg font-semibold">{current ?? "Add your name"}</span>
        <button
          type="button"
          onClick={() => {
            setValue(current ?? "");
            setEditing(true);
          }}
          className="min-h-11 flex-none rounded-lg px-2 text-sm font-semibold text-teal"
        >
          {current ? "Edit" : "Add"}
        </button>
      </span>
    );

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await setName(value.trim());
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save it. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2">
        <input
          // biome-ignore lint/a11y/noAutofocus: opened by tapping Edit, to type the name at once
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={40}
          placeholder="Your name"
          aria-label="Your name"
          className="min-h-11 w-full min-w-0 rounded-xl border border-line-2 px-3 text-base"
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="min-h-11 flex-none rounded-xl bg-teal px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          Save
        </button>
      </span>
      {error && <span className="text-xs text-bad">{error}</span>}
    </form>
  );
}
