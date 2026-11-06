"use client";

import { useState } from "react";
import { ApiError, api, type Traveller } from "@/lib/api";

const input =
  "h-10 min-w-0 rounded-[10px] border border-line-2 bg-white px-3 text-sm outline-none focus:border-teal";

/**
 * A traveller's details, as the hotel needs them: name, email (for the confirmation) and phone.
 * Saves a new traveller, or changes `editing`. They stay on the account; a booking sends them
 * only to the agent hired for it.
 */
export function TravellerForm({
  editing,
  firstOne,
  onSaved,
  onCancel,
}: {
  editing?: Traveller;
  firstOne?: boolean; // the account's first: probably "me"
  onSaved: (t: Traveller) => void;
  onCancel?: () => void;
}) {
  const [f, setF] = useState({
    firstName: editing?.firstName ?? "",
    lastName: editing?.lastName ?? "",
    email: editing?.email ?? "",
    phone: editing?.phone ?? "",
    isSelf: editing?.isSelf ?? !!firstOne,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: k === "isSelf" ? e.target.checked : e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = editing
        ? await api<{ traveller: Traveller }>(`/travellers/${editing.id}`, {
            method: "PATCH",
            body: f,
          })
        : await api<{ traveller: Traveller }>("/travellers", { method: "POST", body: f });
      onSaved(r.traveller);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-2.5 text-sm">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          className={input}
          placeholder="First name"
          autoComplete="given-name"
          required
          value={f.firstName}
          onChange={set("firstName")}
        />
        <input
          className={input}
          placeholder="Last name"
          autoComplete="family-name"
          required
          value={f.lastName}
          onChange={set("lastName")}
        />
        <input
          className={input}
          type="email"
          placeholder="Email (for the confirmation)"
          autoComplete="email"
          required
          value={f.email}
          onChange={set("email")}
        />
        <input
          className={input}
          type="tel"
          placeholder="Phone, like +91 98000 00000"
          autoComplete="tel"
          required
          value={f.phone}
          onChange={set("phone")}
        />
      </div>
      <label className="flex items-center gap-2 text-ink-3">
        <input type="checkbox" checked={f.isSelf} onChange={set("isSelf")} /> This is me
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy}
          className="flex min-h-10 items-center rounded-xl bg-teal px-4 font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Saving…" : editing ? "Save changes" : "Save traveller"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-10 rounded-xl border border-line-2 bg-white px-4 font-semibold"
          >
            Cancel
          </button>
        )}
      </div>
      {error && <p className="text-bad">{error}</p>}
    </form>
  );
}

/** "Ayush K." on a button: enough to tell them apart, not the whole record. */
export const travellerLabel = (t: Traveller) =>
  `${t.firstName} ${t.lastName.slice(0, 1)}.${t.isSelf ? " (me)" : ""}`;
