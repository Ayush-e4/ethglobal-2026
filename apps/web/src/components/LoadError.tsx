"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { InfoIcon } from "./icons";

/** A way out next to "Try again": a link styled as the quieter button. */
export const quietButton =
  "press flex min-h-11 items-center justify-center rounded-xl border border-line-2 bg-white px-4 text-sm font-semibold text-ink";

/**
 * A screen that couldn't load says what happened in words, and offers the way forward: try
 * again (and it tries by itself when the connection comes back), or go somewhere that works.
 * Without `onRetry` (it isn't there to load), only the way out.
 */
export function LoadError({
  title,
  error,
  onRetry,
  children,
}: {
  title: string;
  error: string;
  onRetry?: () => unknown;
  children?: ReactNode;
}) {
  const [trying, setTrying] = useState(false);
  const retry = useCallback(async () => {
    if (!onRetry) return;
    setTrying(true);
    try {
      await onRetry();
    } finally {
      setTrying(false);
    }
  }, [onRetry]);
  useEffect(() => {
    if (!onRetry) return;
    const back = () => void retry();
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, [onRetry, retry]);

  return (
    <section
      role="alert"
      className="fade-in mx-auto my-6 flex w-full max-w-[440px] flex-col items-center gap-2.5 rounded-2xl border border-line bg-white px-5 py-8 text-center"
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-side text-ink-3">
        <InfoIcon size={20} />
      </span>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <p className="max-w-[340px] text-sm leading-relaxed text-ink-3">{error}</p>
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        {onRetry && (
          <button
            type="button"
            onClick={() => void retry()}
            disabled={trying}
            className="press flex min-h-11 items-center justify-center rounded-xl bg-teal px-5 text-sm font-semibold text-white hover:bg-teal-dark disabled:opacity-60"
          >
            {trying ? "Trying again…" : "Try again"}
          </button>
        )}
        {children}
      </div>
    </section>
  );
}

/** The same for one part of a screen (a section of the wallet): a line, with Try again. */
export function RetryLine({ error, onRetry }: { error: string; onRetry: () => unknown }) {
  const [trying, setTrying] = useState(false);
  const retry = useCallback(async () => {
    setTrying(true);
    try {
      await onRetry();
    } finally {
      setTrying(false);
    }
  }, [onRetry]);
  useEffect(() => {
    const back = () => void retry();
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, [retry]);
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-2xl bg-side px-4 py-3 text-sm text-ink-3"
    >
      <span>{error}</span>
      <button
        type="button"
        onClick={() => void retry()}
        disabled={trying}
        className="press flex min-h-10 items-center rounded-lg border border-line-2 bg-white px-3.5 font-semibold text-ink disabled:opacity-60 max-md:min-h-11"
      >
        {trying ? "Trying…" : "Try again"}
      </button>
    </div>
  );
}

/** A settings section that couldn't load: its name, and the line above (not a silent gap). */
export const SectionRetry = ({
  label,
  error,
  onRetry,
}: {
  label: string;
  error: string;
  onRetry: () => unknown;
}) => (
  <section
    aria-label={label}
    className="flex flex-col gap-3 rounded-2xl border border-line p-4 text-sm"
  >
    <span className="font-semibold">{label}</span>
    <RetryLine error={error} onRetry={onRetry} />
  </section>
);

/** The usual way out: back to the chat, where anything can be asked. */
export const ToChat = ({ label = "Go to chat" }: { label?: string }) => (
  <Link href="/chat" replace className={quietButton}>
    {label}
  </Link>
);
