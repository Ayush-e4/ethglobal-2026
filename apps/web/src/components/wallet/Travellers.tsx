"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Traveller } from "@/lib/api";
import { TravellerForm } from "../travellers/TravellerForm";

const small = "h-8 rounded-lg border border-line-2 bg-white px-3 text-xs font-semibold";

/** Your saved travellers (up to 5): who bookings can be for. Add, change, remove. */
export function Travellers() {
  const [list, setList] = useState<Traveller[] | null>(null);
  const [max, setMax] = useState(5);
  const [editing, setEditing] = useState<Traveller | "new" | null>(null);

  const load = useCallback(
    () =>
      api<{ travellers: Traveller[]; max: number }>("/travellers")
        .then((r) => {
          setList(r.travellers);
          setMax(r.max);
        })
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!list) return null;

  const remove = async (t: Traveller) => {
    await api(`/travellers/${t.id}`, { method: "DELETE" }).catch(() => {});
    void load();
  };

  return (
    <section
      aria-label="Travellers"
      className="flex flex-col gap-3 rounded-2xl border border-line p-4 text-sm"
    >
      <div className="flex flex-col gap-1">
        <span className="font-semibold">Travellers</span>
        <span className="text-ink-3">
          Who your bookings can be for, up to {max}. A booking sends the chosen one's details only
          to the agent you hire, and on to the hotel or airline.
        </span>
      </div>
      {list.length > 0 && (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
          {list.map((t) =>
            editing !== "new" && editing?.id === t.id ? (
              <li key={t.id} className="p-3">
                <TravellerForm
                  editing={t}
                  onSaved={() => {
                    setEditing(null);
                    void load();
                  }}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
              >
                <span className="flex flex-col">
                  <span className="font-semibold">
                    {t.firstName} {t.lastName}
                    {t.isSelf && (
                      <span className="ml-1.5 text-xs font-normal text-muted">(me)</span>
                    )}
                  </span>
                  <span className="text-xs text-muted">
                    {t.email} · {t.phone}
                  </span>
                </span>
                <span className="flex gap-2">
                  <button type="button" onClick={() => setEditing(t)} className={small}>
                    Change
                  </button>
                  <button type="button" onClick={() => remove(t)} className={`${small} text-bad`}>
                    Remove
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      {editing === "new" ? (
        <TravellerForm
          firstOne={list.length === 0}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        list.length < max && (
          <button type="button" onClick={() => setEditing("new")} className={`${small} self-start`}>
            + Add a traveller
          </button>
        )
      )}
    </section>
  );
}
