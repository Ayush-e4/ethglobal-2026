"use client";

import type { Card } from "@app/shared";
import type { CardCtx } from "./Cards";
import { CardView } from "./Cards";
import { Markdown } from "./Markdown";

export interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  cards: Card[];
  status?: string; // what the concierge is doing right now, while streaming
  streaming?: boolean;
  error?: string;
}

export function Messages({
  turns,
  onReply,
  busy,
  ctx,
}: {
  turns: Turn[];
  onReply: (t: string) => void;
  busy: boolean;
  ctx: Pick<CardCtx, "chatId" | "isDemo">;
}) {
  // Only the latest reply's cards can be acted on; older ones are history.
  const latest = turns.findLast((t) => t.role === "assistant")?.id;
  return (
    <ol aria-label="Conversation" className="flex flex-col gap-7">
      {turns.map((t) =>
        t.role === "user" ? (
          <li
            key={t.id}
            className="flex max-w-[85%] flex-col gap-2 self-end rounded-[18px_18px_4px_18px] bg-bubble px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] sm:max-w-[78%]"
          >
            {t.cards.map((c) =>
              c.type === "photos" ? (
                <span key="photos" className="flex flex-wrap gap-2">
                  {c.thumbs.map((src, i) => (
                    // biome-ignore lint/performance/noImgElement: a small stored thumbnail
                    <img
                      key={src.slice(-24)}
                      src={src}
                      alt={`Photo ${i + 1}`}
                      className="max-h-40 rounded-xl border border-line bg-white object-cover"
                    />
                  ))}
                </span>
              ) : null,
            )}
            {t.text && <span>{t.text}</span>}
          </li>
        ) : (
          // Replies run the full width, flush with the page (no avatar beside them).
          <li key={t.id} className="flex min-w-0 flex-col gap-4 [overflow-wrap:anywhere]">
            <span className="text-[13px] font-semibold text-ink-3">Concierge</span>
            {t.text &&
              (t.streaming ? (
                <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{t.text}</p>
              ) : (
                <Markdown text={t.text} />
              ))}
            {t.cards
              .map((card, n) => ({ card, id: `${t.id}-card${n}` })) // a turn's cards never reorder
              .map(({ card, id }) => (
                <CardView
                  key={id}
                  card={card}
                  ctx={{ ...ctx, onReply, busy: busy || t.id !== latest }}
                />
              ))}
            {t.streaming && (
              <p role="status" className="flex items-center gap-2 text-sm text-muted">
                <span aria-hidden className="size-2 animate-pulse rounded-full bg-saffron" />
                {t.status ?? (t.text ? "Writing" : "Thinking")}
              </p>
            )}
            {t.error && (
              <p role="alert" className="rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad">
                {t.error}
              </p>
            )}
          </li>
        ),
      )}
    </ol>
  );
}
