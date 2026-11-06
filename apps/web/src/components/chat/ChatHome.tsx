"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, type ChatSummary } from "@/lib/api";
import { useEnter } from "@/lib/native/motion";
import type { Photo } from "@/lib/photos";
import { useSession } from "@/lib/session";
import { ChatIcon, HotelIcon, MarketIcon, UndoIcon } from "../icons";
import { InstallCard } from "../shell/Pwa";
import { Composer } from "./Composer";

/** The first message is handed to the chat page this way, so it sends once the page is open. */
export const PENDING_KEY = (chatId: string) => `pending:${chatId}`;

/** The first message, carried to the new chat's page (photos too, when they fit). */
export function savePending(chatId: string, text: string, photos: Photo[]) {
  try {
    sessionStorage.setItem(PENDING_KEY(chatId), JSON.stringify({ text, photos }));
  } catch {
    sessionStorage.setItem(PENDING_KEY(chatId), JSON.stringify({ text, photos: [] }));
  }
}
export function readPending(raw: string): { text: string; photos: Photo[] } {
  try {
    const p = JSON.parse(raw) as { text?: unknown; photos?: unknown };
    if (typeof p.text === "string")
      return { text: p.text, photos: Array.isArray(p.photos) ? (p.photos as Photo[]) : [] };
  } catch {}
  return { text: raw, photos: [] };
}

const SUGGESTIONS = [
  {
    title: "Find me a hotel in Goa for 2, next weekend",
    hint: "Live, firm prices from hotel agents",
    tone: "bg-saffron-soft text-saffron-ink",
    Icon: HotelIcon,
  },
  {
    title: "Which agents can book hotels for me?",
    hint: "See who's on the open market",
    tone: "bg-teal-soft text-teal",
    Icon: MarketIcon,
  },
  {
    title: "What happens if I change my mind after booking?",
    hint: "The undo window, in plain words",
    tone: "bg-[#E9F3E6] text-[#2F6A2A]",
    Icon: UndoIcon,
  },
  {
    title: "How do agent fees and limits work?",
    hint: "Paid only when the job is done",
    tone: "bg-bubble text-ink-2",
    Icon: ChatIcon,
  },
];

export function ChatHome() {
  const router = useRouter();
  const { me, refreshChats } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  useEnter(grid);

  const start = async (text: string, photos: Photo[] = []) => {
    setBusy(true);
    setError(null);
    try {
      const chat = await api<ChatSummary>("/chats", {
        method: "POST",
        body: { title: (text || "A photo").slice(0, 60) },
      });
      savePending(chat.id, text, photos);
      await refreshChats();
      router.push(`/chat/${chat.id}`, { transitionTypes: ["nav-forward"] });
    } catch {
      setError("Couldn't start a chat. Is the API running?");
      setBusy(false);
    }
  };

  const name = me?.displayName ? `, ${me.displayName}` : "";
  return (
    <main className="mx-auto flex w-full max-w-[780px] flex-col gap-6 px-4 pt-8 pb-10 sm:gap-9 sm:px-6 sm:pt-16 sm:pb-14">
      <div className="flex flex-col gap-2.5 text-center">
        <h1 className="text-[26px] leading-tight font-bold tracking-tight sm:text-[34px]">
          What can I help with{name}?
        </h1>
        <p className="mx-auto max-w-[560px] text-[15px] leading-relaxed text-ink-3 sm:text-base">
          Ask about anything. When something needs doing, I'll book an agent from the open market.
          You can undo any payment, and agents are paid only when the job is done.
        </p>
      </div>
      <Composer onSend={start} disabled={busy} placeholder="Ask anything" />
      <InstallCard />
      {error && (
        <p role="alert" className="text-center text-sm text-bad">
          {error}
        </p>
      )}
      <div
        ref={grid}
        className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-3"
      >
        {SUGGESTIONS.map((s) => (
          <button
            data-enter
            key={s.title}
            type="button"
            disabled={busy}
            onClick={() => start(s.title)}
            className="flex items-center gap-3.5 rounded-2xl border border-line bg-white p-3.5 text-left hover:border-line-2 disabled:opacity-60 sm:p-4"
          >
            <span
              aria-hidden
              className={`flex size-10 flex-none items-center justify-center rounded-xl ${s.tone}`}
            >
              <s.Icon size={19} />
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-[15px] leading-snug font-semibold">{s.title}</span>
              <span className="text-[13px] text-muted">{s.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="text-center text-xs text-muted">
        Shikigami can make mistakes. Check bookings before you travel.
      </p>
    </main>
  );
}
