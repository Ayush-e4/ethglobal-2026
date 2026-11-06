"use client";

import type { Card } from "@app/shared";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type Traveller } from "@/lib/api";
import { CheckIcon } from "../icons";
import { TravellerForm, travellerLabel } from "../travellers/TravellerForm";
import type { CardCtx } from "./Cards";

type TravellerCardData = Extract<Card, { type: "traveller" }>;

/**
 * Before booking: who is it for? Your saved travellers, or someone new (saved for next time, up
 * to 5). The details never go in the chat or to the AI; the booking sends them only to the agent
 * you hire. Once chosen, the booking carries on.
 */
export function TravellerCard({ card, ctx }: { card: TravellerCardData; ctx: CardCtx }) {
  const [list, setList] = useState<Traveller[] | null>(null);
  const [max, setMax] = useState(5);
  const [chosen, setChosen] = useState<Traveller | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [all, mine] = await Promise.all([
      api<{ travellers: Traveller[]; max: number }>("/travellers"),
      api<{ traveller: Traveller | null }>(`/chats/${ctx.chatId}/traveller`),
    ]).catch(() => [null, null] as const);
    if (all) {
      setList(all.travellers);
      setMax(all.max);
      if (all.travellers.length === 0) setAdding(true);
    }
    if (mine?.traveller) setChosen(mine.traveller);
  }, [ctx.chatId]);
  useEffect(() => {
    void load();
  }, [load]);

  const choose = async (t: Traveller) => {
    setError(null);
    try {
      await api(`/chats/${ctx.chatId}/traveller`, { method: "POST", body: { travellerId: t.id } });
      setChosen(t);
      ctx.onReply(card.reply);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't choose. Try again.");
    }
  };

  return (
    <section
      aria-label="Who is this booking for?"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4 sm:p-[18px]"
    >
      <div className="flex flex-col gap-1">
        <span className="text-[15px] font-bold">Who is this booking for?</span>
        <span className="text-sm text-ink-3">
          Their details go only to {card.agentName}, for this booking, and on to the hotel or
          airline. They stay out of the chat.
        </span>
      </div>
      {chosen ? (
        <p role="status" className="flex items-center gap-2 text-sm font-semibold text-ok">
          <CheckIcon size={16} /> Booking for {chosen.firstName} {chosen.lastName}
        </p>
      ) : (
        <>
          {list && list.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {list.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={ctx.busy}
                  onClick={() => choose(t)}
                  className="flex min-h-10 items-center rounded-xl border border-line-2 bg-white px-4 text-sm font-semibold hover:border-teal disabled:opacity-50"
                >
                  {travellerLabel(t)}
                </button>
              ))}
              {!adding && list.length < max && (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="flex min-h-10 items-center rounded-xl border border-dashed border-line-2 px-4 text-sm font-semibold text-teal"
                >
                  + Someone else
                </button>
              )}
            </div>
          )}
          {list && list.length >= max && (
            <span className="text-xs text-muted">
              Up to {max} travellers: remove one on the Wallet page.
            </span>
          )}
          {adding && (
            <TravellerForm
              firstOne={list?.length === 0}
              onSaved={(t) => {
                setAdding(false);
                setList([...(list ?? []), t]);
                void choose(t);
              }}
              onCancel={list && list.length > 0 ? () => setAdding(false) : undefined}
            />
          )}
        </>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
    </section>
  );
}
