"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type WorldInfo } from "@/lib/api";
import { realName, useSession } from "@/lib/session";
import { CheckIcon } from "../icons";

type Step = { id: string; title: string; why: string; href: string; cta: string; done: boolean };

const hiddenKey = (userId: string) => `getting-started:hidden:${userId}`;

/**
 * Getting started, on the chat home: the few things that make Shikigami work for you, each
 * ticked off from your account as you do it (a chat, World ID, your name, Telegram, a shop paid
 * in person). Gone once all are done, or when dismissed.
 */
export function GettingStarted() {
  const { me, chats } = useSession();
  const [state, setState] = useState<{
    world: boolean | null;
    telegram: boolean | null;
  }>({ world: null, telegram: null });
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (!me) return;
    try {
      setHidden(localStorage.getItem(hiddenKey(me.id)) === "1");
    } catch {
      setHidden(false);
    }
    void Promise.all([
      me.isDemo ? null : api<WorldInfo>("/world").catch(() => null),
      api<{ available: boolean; linked: boolean }>("/alerts").catch(() => null),
    ]).then(([w, a]) =>
      setState({
        world: w ? !!w.verified || !w.available : null,
        telegram: a ? a.linked || !a.available : null,
      }),
    );
  }, [me]);

  if (!me || hidden) return null;
  const steps: Step[] = [
    {
      id: "chat",
      title: "Ask for something",
      why: "A question, a plan or a job: agents from the open market quote, you pick.",
      href: "/agents",
      cta: "See the agents",
      done: chats.length > 0,
    },
    ...(me.isDemo
      ? []
      : [
          {
            id: "world",
            title: "Prove you're a person with World ID",
            why: "For larger payments, rating agents and running a shop. Nothing about who you are.",
            href: "/wallet",
            cta: "Verify",
            done: !!state.world,
          },
        ]),
    {
      id: "telegram",
      title: "Chat from Telegram too",
      why: "The same concierge, and each booking live: undo, its reference, the payment.",
      href: "/settings#alerts",
      cta: "Connect",
      done: !!state.telegram,
    },
    ...(me.isDemo
      ? []
      : [
          {
            id: "name",
            title: "Tell us your name",
            why: "So Shikigami greets you, not your device.",
            href: "/settings",
            cta: "Add",
            done: !!realName(me.displayName),
          },
        ]),
    {
      id: "shop",
      title: "Pay a shop in person",
      why: "Scan a shop's Live QR or listen for its chirp: a sticker or a screenshot can't fool it.",
      href: "/pay",
      cta: "Try it",
      done: false,
    },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (left === 0) return null;
  const hide = () => {
    try {
      localStorage.setItem(hiddenKey(me.id), "1");
    } catch {}
    setHidden(true);
  };

  return (
    <section
      aria-labelledby="getting-started"
      className="flex flex-col gap-3 rounded-2xl border border-warm-line bg-warm p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="getting-started" className="font-semibold">
          Getting started{" "}
          <span className="text-sm font-normal text-muted">
            · {steps.length - left} of {steps.length} done
          </span>
        </h2>
        <button
          type="button"
          onClick={hide}
          className="min-h-11 rounded-xl px-2 text-sm font-semibold text-ink-3 hover:text-ink"
        >
          Hide
        </button>
      </div>
      <ol className="flex flex-col gap-2">
        {steps.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-3 rounded-xl border border-line bg-white p-3"
          >
            <span
              aria-hidden
              className={`flex size-7 flex-none items-center justify-center rounded-full ${s.done ? "bg-ok text-white" : "border border-line-2 bg-white"}`}
            >
              {s.done && <CheckIcon size={15} />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={`text-sm font-semibold ${s.done ? "text-muted line-through" : ""}`}>
                {s.title}
              </span>
              {!s.done && <span className="text-xs leading-snug text-ink-3">{s.why}</span>}
            </span>
            {!s.done && (
              <Link
                href={s.href}
                className="flex min-h-11 flex-none items-center rounded-xl border border-line-2 bg-white px-3 text-sm font-semibold text-teal"
              >
                {s.cta}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
