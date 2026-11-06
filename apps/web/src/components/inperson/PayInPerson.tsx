"use client";

import { type Card, decodeRequest, toHex } from "@app/shared";
import { useEffect, useRef, useState } from "react";
import { hashscanTx } from "@/lib/api";
import { useBackToClose } from "@/lib/native/back";
import { haptic } from "@/lib/native/haptics";
import { LimitCard } from "../chat/LimitCard";
import { SuccessMark } from "../SuccessMark";
import { WaitSteps } from "../WaitSteps";
import { Camera } from "./Camera";
import { Shell } from "./GetPaid";
import { Listening, LiveLine } from "./pay-lines";
import type { createScanner } from "./scanner";
import { LISTEN_ONE_MORE_CYCLE_MS, listen, preloadSound } from "./sound";

type Seen = {
  merchant: { name: string; account: string; verified: boolean };
  inr: number;
  status: "open" | "paying" | "paid" | "expired";
  live: { ok: boolean; reason?: string } | null;
};
type LimitData = Extract<Card, { type: "limit" }>;
const btn =
  "flex min-h-12 w-full items-center justify-center rounded-xl px-5 text-[15px] font-semibold";

async function post<T>(path: string, body: unknown) {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    ok: res.ok,
    data: (await res.json().catch(() => ({}))) as T & { message?: string; error?: string },
  };
}

/**
 * Paying a shop in person: scan its Live QR, see who and how much (checked by our server: a
 * registered merchant's own request, still open), wait a moment for "Live screen ✓", then pay
 * from your limit for that shop on Hedera. A screenshot or a sticker never turns live.
 */
export function PayInPerson() {
  const [step, setStep] = useState<"idle" | "scan" | "paying" | "paid">("idle");
  const [via, setVia] = useState<"qr" | "sound">("qr");
  const ears = useRef<Awaited<ReturnType<typeof listen>> | null>(null);
  const [heardOne, setHeardOne] = useState(false);
  useEffect(() => {
    preloadSound();
    return () => ears.current?.stop();
  }, []);
  const [frame, setFrame] = useState<string | null>(null);
  const [seen, setSeen] = useState<Seen | null>(null);
  const [live, setLive] = useState<string | null>(null);
  const [plain, setPlain] = useState(false);
  const [limit, setLimit] = useState<{ card: LimitData; chatId: string } | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scanner = useRef<ReturnType<typeof createScanner> | null>(null);

  const onRequest = async (f: string, hasLive: boolean) => {
    setFrame(f);
    setLive(null);
    setPlain(!hasLive);
    setError(null);
    const r = await post<Seen>("/pay/check", { frame: f });
    if (r.ok) setSeen(r.data);
    else setError(r.data.message ?? "Not a Shikigami payment code.");
  };
  const onLive = async (code: string) => {
    if (!frame || live) return;
    const r = await post<Seen>("/pay/check", { frame, live: code });
    if (r.ok && r.data.live?.ok) {
      setLive(code);
      scanner.current?.liveConfirmed();
    }
  };
  const pay = async () => {
    if (!frame) return;
    setStep("paying");
    setError(null);
    const r = await post<{ payTx: string; card?: LimitData; chatId?: string }>("/pay", {
      frame,
      live: live ?? undefined,
      how: via,
    });
    if (r.ok) {
      setTx(r.data.payTx);
      setStep("paid");
      haptic("success");
    } else if (r.data.error === "needs_limit" && r.data.card && r.data.chatId) {
      setLimit({ card: r.data.card, chatId: r.data.chatId });
      setStep("scan");
    } else {
      setError(r.data.message ?? "The payment didn't go through. Nothing was charged.");
      setStep("scan");
      haptic("error");
    }
  };
  const toIdle = () => {
    ears.current?.stop();
    ears.current = null;
    setHeardOne(false);
    setFrame(null);
    setSeen(null);
    setLive(null);
    setLimit(null);
    setError(null);
    setStep("idle");
  };
  // Back (Android's button, the iPhone's swipe) steps out of the scan to the start, not off the
  // page; while a payment is going through it does nothing: it can't be called back mid-way.
  const stepNow = useRef(step);
  stepNow.current = step;
  useBackToClose(step === "scan" || step === "paying", () => {
    if (stepNow.current === "paying") return;
    toIdle();
  });
  const reset = () => {
    ears.current?.stop();
    ears.current = null;
    setFrame(null);
    setSeen(null);
    setLive(null);
    setLimit(null);
    setTx(null);
    setError(null);
    setStep("scan");
  };

  // Listening starts in the tap itself (iPhones); the mic stops once a request is heard.
  const startListening = async () => {
    setError(null);
    setVia("sound");
    setStep("scan");
    // After the first request, listen one more full cycle of the shop's chirps: if a different
    // request turns up too (someone nearby chirping their own), refuse rather than guess.
    const heard = new Set<string>();
    let deciding: ReturnType<typeof setTimeout> | null = null;
    try {
      ears.current = await listen((bytes) => {
        if (!decodeRequest(bytes).ok) return; // noise, or someone else's chirp format
        heard.add(toHex(bytes));
        setHeardOne(true);
        if (deciding) return;
        deciding = setTimeout(() => {
          ears.current?.stop();
          ears.current = null;
          setHeardOne(false);
          if (heard.size > 1) {
            setError(
              "Two different payment requests were heard at once: someone nearby is chirping too. Scan the shop's QR instead.",
            );
            setStep("idle");
            return;
          }
          const [only] = heard;
          if (only) void onRequest(only, false);
        }, LISTEN_ONE_MORE_CYCLE_MS);
      });
    } catch {
      setError(
        "Allow the microphone to listen (it needs the app's https address), then try again.",
      );
      setStep("idle");
    }
  };

  if (step === "paid" && seen)
    return (
      <Shell title="Paid">
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-white p-6 text-center">
          <SuccessMark />
          <span className="text-sm font-semibold text-ok">Paid</span>
          <span className="text-[30px] font-bold">₹{seen.inr.toLocaleString("en-IN")}</span>
          <span className="text-sm text-ink-2">to {seen.merchant.name}</span>
          <span className="text-xs text-muted">
            {live ? "Live screen confirmed" : "Paid without the live check"} ·{" "}
            {seen.merchant.account}
          </span>
          {tx && (
            <a
              href={hashscanTx(tx)}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs text-teal underline"
            >
              See it on Hedera
            </a>
          )}
        </div>
        <button type="button" onClick={reset} className={`${btn} border border-line-2 bg-white`}>
          Scan another
        </button>
      </Shell>
    );

  if (step === "idle")
    return (
      <Shell title="Pay in person">
        <p className="text-sm text-ink-2">
          Scan a shop&apos;s Shikigami QR. You&apos;ll see who you&apos;re paying and how much
          before anything moves, and the app checks the QR is live on their screen, not a sticker or
          a screenshot.
        </p>
        <button
          type="button"
          onClick={() => {
            setVia("qr");
            setStep("scan");
          }}
          className={`${btn} bg-teal text-white`}
        >
          Scan to pay
        </button>
        <button
          type="button"
          onClick={() => void startListening()}
          className={`${btn} border border-line-2 bg-white`}
        >
          Listen to pay
        </button>
        <p className="text-xs text-muted">
          Listen: the shop&apos;s device plays the request as a short chirp. Hold your phone 20–50
          cm from it, still.
        </p>
        {error && <p className="text-sm text-bad">{error}</p>}
      </Shell>
    );

  // One camera for the whole scan: it keeps reading the live layer while the sheet is up.
  const watching = via === "qr" && (!seen || (!live && !plain && seen.status === "open"));
  return (
    <Shell title={via === "qr" ? "Scan to pay" : "Listen to pay"}>
      {via === "sound" && !seen && (
        <Listening heard={heardOne} levels={() => ears.current?.bands(16) ?? null} />
      )}
      {watching && (
        <div className={seen ? "max-h-32 overflow-hidden rounded-2xl opacity-80" : ""}>
          <Camera scanner={scanner} onRequest={onRequest} onLive={onLive} onError={setError} />
        </div>
      )}
      {seen && (
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-5">
          <span className="text-sm text-ink-2">
            Pay <b>{seen.merchant.name}</b>
            <span className={`ml-1 text-xs ${seen.merchant.verified ? "text-ok" : "text-muted"}`}>
              {seen.merchant.verified ? "✓ verified person" : "not verified"}
            </span>
          </span>
          <span className="text-[34px] font-bold tracking-tight">
            ₹{seen.inr.toLocaleString("en-IN")}
          </span>
          <LiveLine live={live} plain={plain} heard={via === "sound"} />
          {seen.status !== "open" ? (
            <p className="text-sm text-bad">
              {seen.status === "paid" ? "Already paid." : "Expired: ask the shop for a new one."}
            </p>
          ) : limit ? (
            <LimitCard
              card={limit.card}
              ctx={{ chatId: limit.chatId, isDemo: false, onReply: () => void pay() }}
            />
          ) : (
            // A QR pays only once it proved it's the shop's live screen (the server checks too).
            <button
              type="button"
              onClick={pay}
              disabled={step === "paying" || (via === "qr" && !live)}
              className={`${btn} bg-teal text-white disabled:opacity-50`}
            >
              {step === "paying"
                ? "Paying…"
                : via === "qr" && !live
                  ? plain
                    ? "Can't pay a QR that isn't live"
                    : "Waiting for the live check…"
                  : `Pay ₹${seen.inr.toLocaleString("en-IN")}`}
            </button>
          )}
          {step === "paying" && (
            <WaitSteps
              steps={[
                [0, "Sending the payment to Hedera…"],
                [5, "Hedera is confirming it…"],
                [15, "A first payment also sets up your spending limit on Hedera: keep this open."],
                [60, "Still going: Hedera is slow right now. Nothing is charged twice."],
              ]}
            />
          )}
          <button
            type="button"
            onClick={reset}
            className="min-h-11 text-sm font-semibold text-ink-3"
          >
            Cancel
          </button>
        </div>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
    </Shell>
  );
}
