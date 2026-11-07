"use client";

import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";

type Status = { available: boolean; linked: boolean };

const small =
  "h-9 max-md:h-11 rounded-[10px] border border-line-2 bg-white px-3 text-[13px] font-semibold";

/**
 * Phone alerts in Telegram: when an agent books, refunds, or finds your room cheaper, our bot
 * messages you, with a link back to the chat. You connect by tapping Start on our bot through a
 * one-time link (a QR code on a laptop); /stop in Telegram, or Disconnect here, ends it.
 */
export function Alerts() {
  const [s, setS] = useState<Status | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<Status>("/alerts")
        .then((r) => {
          setS(r);
          if (r.linked) setLink(null);
          return r;
        })
        .catch(() => null),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // Waiting for the Start tap in Telegram.
  useEffect(() => {
    if (!link) return;
    const t = setInterval(
      () =>
        void load().then((r) => {
          if (r?.linked) setNote("Connected. A test alert is one tap away.");
        }),
      3000,
    );
    return () => clearInterval(t);
  }, [link, load]);

  if (!s?.available) return null;

  const act = async (fn: () => Promise<void>) => {
    setNote(null);
    try {
      await fn();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "That didn't work. Try again.");
    }
  };
  const connect = () =>
    act(async () => {
      const { url } = await api<{ url: string }>("/alerts/telegram", { method: "POST" });
      setLink(url);
    });
  const test = () =>
    act(async () => {
      const { sent } = await api<{ sent: boolean }>("/alerts/test", { method: "POST" });
      setNote(sent ? "Sent: check Telegram." : "Couldn't reach your Telegram chat.");
    });
  const disconnect = () =>
    act(async () => {
      await api("/alerts/telegram", { method: "DELETE" });
      await load();
    });

  return (
    <section
      id="alerts"
      aria-label="Phone alerts"
      className="flex flex-col gap-3 rounded-2xl border border-line p-4 text-sm"
    >
      <div className="flex flex-col gap-1">
        <span className="font-semibold">Phone alerts</span>
        <span className="text-ink-3">
          Chat with Shikigami in Telegram, and get a message there when an agent books, refunds, or
          finds you a better price.
        </span>
      </div>
      {s.linked ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 font-semibold text-ok">✓ Telegram connected</span>
          <button type="button" onClick={test} className={small}>
            Send a test
          </button>
          <button type="button" onClick={disconnect} className={`${small} text-bad`}>
            Disconnect
          </button>
        </div>
      ) : link ? (
        <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-line bg-white p-4">
          <QRCodeSVG
            value={link}
            size={132}
            marginSize={1}
            className="hidden sm:block"
            aria-label="QR code to connect Telegram"
          />
          <div className="flex min-w-[200px] flex-1 flex-col gap-2">
            <span className="text-ink-3">
              <span className="hidden sm:inline">Scan this with your phone, or </span>open our bot
              in Telegram and tap <strong>Start</strong>.
            </span>
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-10 max-md:min-h-11 items-center justify-center self-start rounded-xl bg-teal px-4 font-semibold text-white"
            >
              Open Telegram
            </a>
            <span role="status" className="flex items-center gap-2 text-xs text-muted">
              <span className="size-2 animate-pulse rounded-full bg-saffron" />
              Waiting for you to tap Start
            </span>
          </div>
        </div>
      ) : (
        <button type="button" onClick={connect} className={`${small} self-start`}>
          Connect Telegram
        </button>
      )}
      {note && <span className="text-xs text-ink-3">{note}</span>}
    </section>
  );
}
