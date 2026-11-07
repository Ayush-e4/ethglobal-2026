"use client";

import { fromHex } from "@app/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, hashscanTx } from "@/lib/api";
import { friendly } from "@/lib/errors";
import { useBackToClose } from "@/lib/native/back";
import { useWakeLock } from "@/lib/native/wake-lock";
import { useSession } from "@/lib/session";
import { LoadError } from "../LoadError";
import { CardSkeleton } from "../Skeleton";
import { SuccessMark } from "../SuccessMark";
import { LiveQr } from "./LiveQr";
import { Shell, Verified } from "./shell";
import { btn, type Merchant, SetUpShop } from "./shop-parts";
import { chirp, openAudio, preloadSound, stopChirps } from "./sound";

type Req = { id: string; frame: string; liveKey: string; inr: number; expiresAt: string };
type Status = {
  status: "open" | "paying" | "paid" | "expired";
  payTx: string | null;
  live: boolean | null;
};
const PICKS = [20, 40, 100, 250];
const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/**
 * Getting paid in person, on the shop's screen: an amount, then a Live QR the customer scans
 * with Shikigami. The screen turns "Paid" by itself once Hedera has the payment.
 */
export function GetPaid() {
  const { me } = useSession();
  const [merchant, setMerchant] = useState<Merchant | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [inr, setInr] = useState("40");
  const [req, setReq] = useState<Req | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [left, setLeft] = useState(0);
  const [chirping, setChirping] = useState(false);
  const speaker = useRef<{ stop: () => void } | null>(null);
  const [asking, setAsking] = useState(false); // a request on its way: no second one meanwhile
  const quiet = () => {
    stopChirps(); // also one still starting up
    speaker.current = null;
    setChirping(false);
  };
  useEffect(() => {
    preloadSound();
    return () => stopChirps();
  }, []);
  // Paid, expired or a new request: the chirp stops.
  useEffect(() => {
    if (req && status?.status !== "paid" && status?.status !== "expired" && left !== 0) return;
    stopChirps();
    speaker.current = null;
    setChirping(false);
  }, [req, status?.status, left]);
  /** The request as sound too, for a payer who'd rather listen (started from this tap). */
  const toggleChirp = async () => {
    if (speaker.current) return quiet();
    if (!req) return;
    try {
      const h = await chirp(fromHex(req.frame));
      if (h) {
        speaker.current = h;
        setChirping(true);
      }
    } catch {
      setError("The sound didn't start. Check the volume and try again.");
    }
  };
  const [error, setError] = useState<string | null>(null);

  // While the QR is up: back returns to the amount (not off the page), and the screen stays on.
  useBackToClose(!!req, () => {
    quiet();
    setReq(null);
  });
  useWakeLock(!!req && status?.status !== "paid" && status?.status !== "expired" && left !== 0);

  // Couldn't load the shop: say so (not the set-up form, as if there were none), and retry.
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadShop = useCallback(
    () =>
      api<{ merchant: Merchant | null }>("/merchant")
        .then((r) => {
          setMerchant(r.merchant);
          setLoadError(null);
        })
        .catch((err) => setLoadError(friendly(err, "Couldn't load your shop."))),
    [],
  );
  useEffect(() => {
    void loadShop();
  }, [loadShop]);
  const [lost, setLost] = useState(false); // the QR's "paid yet?" checks aren't getting through

  // While the QR is up: is it paid yet, and how long it has left.
  useEffect(() => {
    if (!req) return;
    const end = new Date(req.expiresAt).getTime();
    const t = setInterval(async () => {
      setLeft(Math.max(0, Math.round((end - Date.now()) / 1000)));
      const s = await api<Status>(`/merchant/requests/${req.id}`).catch(() => null);
      setLost(!s);
      if (s) setStatus(s);
      if (s?.status === "paid" || s?.status === "expired") clearInterval(t);
    }, 1500);
    return () => clearInterval(t);
  }, [req]);

  const fail = (e: unknown) => setError(friendly(e, "Something went wrong. Try again."));
  const setUp = () =>
    api<{ merchant: Merchant }>("/merchant", { method: "POST", body: { name } })
      .then((r) => setMerchant(r.merchant))
      .catch(fail);
  const ask = () => {
    if (asking) return;
    setAsking(true);
    setError(null);
    setStatus(null);
    // The chirp starts with the QR, so its audio is opened now, inside this tap (phones only
    // start sound from one); it plays once the request is ready.
    const audio = openAudio();
    api<Req>("/merchant/requests", { method: "POST", body: { inr: Number(inr) } })
      .then(async (r) => {
        setReq(r);
        setLeft(Math.round((new Date(r.expiresAt).getTime() - Date.now()) / 1000));
        try {
          const h = await chirp(fromHex(r.frame), audio);
          if (h) {
            speaker.current = h;
            setChirping(true);
          }
        } catch {
          setError("The chirp didn't start: tap Play the chirp, and check the volume.");
        }
      })
      .catch((e) => {
        void audio.then((c) => c.close()).catch(() => {});
        fail(e);
      })
      .finally(() => setAsking(false));
  };

  if (merchant === undefined)
    return (
      <Shell title="Get paid in person">
        {loadError ? (
          <LoadError title="Couldn't load your shop" error={loadError} onRetry={loadShop} />
        ) : (
          <CardSkeleton label="Loading your shop" />
        )}
      </Shell>
    );
  if (!merchant)
    return (
      <SetUpShop
        isDemo={!!me?.isDemo}
        name={name}
        onName={setName}
        onSubmit={() => void setUp()}
        error={error}
      />
    );

  const paid = status?.status === "paid";
  if (req)
    return (
      <Shell title={merchant.name} sub={<Verified m={merchant} />}>
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-white p-5 text-center">
          <span className="text-[34px] font-bold tracking-tight">{rupees(req.inr)}</span>
          {paid ? (
            <div className="flex flex-col items-center gap-2 py-6">
              <SuccessMark />
              <span className="text-lg font-bold text-ok">Paid</span>
              {status?.payTx && (
                <a
                  href={hashscanTx(status.payTx)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-xs text-teal underline"
                >
                  See it on Hedera
                </a>
              )}
            </div>
          ) : status?.status === "expired" || (left === 0 && status?.status !== "paying") ? (
            <p className="py-10 text-sm text-muted">This request expired. Ask again.</p>
          ) : (
            <>
              <LiveQr frame={req.frame} liveKey={req.liveKey} />
              <p className="text-sm text-ink-2">
                {status?.status === "paying" ? "Paying…" : "Scan with Shikigami to pay"} · {left}s
              </p>
              {lost && (
                <p role="status" className="text-xs font-semibold text-saffron-ink">
                  Reconnecting… a payment still lands, and this turns Paid once it&apos;s back.
                </p>
              )}
              <p className="text-xs text-muted">
                This QR proves it&apos;s live on this screen: a sticker or a screenshot of it
                won&apos;t pass.
              </p>
              <button
                type="button"
                onClick={() => void toggleChirp()}
                aria-pressed={chirping}
                className={`min-h-11 rounded-full px-4 text-sm font-semibold ${chirping ? "bg-teal text-white" : "border border-line-2 bg-white text-teal"}`}
              >
                {chirping ? "🔊 Chirping · tap to mute" : "Play the chirp"}
              </button>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            quiet();
            setReq(null);
          }}
          className={`${btn} border border-line-2 bg-white`}
        >
          {paid || (left === 0 && status?.status !== "paying") ? "New request" : "Cancel"}
        </button>
      </Shell>
    );

  return (
    <Shell title={merchant.name} sub={<Verified m={merchant} />}>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Amount
        <span className="flex min-h-14 items-center gap-1 rounded-xl border border-line-2 bg-white px-3 text-[28px] font-bold">
          ₹
          <input
            inputMode="numeric"
            value={inr}
            onChange={(e) => setInr(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="w-full bg-transparent outline-none"
            aria-label="Amount in rupees"
          />
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        {PICKS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setInr(String(p))}
            className="min-h-10 max-md:min-h-11 rounded-full border border-line-2 bg-white px-4 text-sm font-semibold"
          >
            {rupees(p)}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={ask}
        disabled={!Number(inr) || asking}
        className={`${btn} bg-teal text-white disabled:opacity-50`}
      >
        Show payment QR
      </button>
      <p className="text-xs text-muted">Testnet: ₹1 is paid as 0.000001 test USDC on Hedera.</p>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
    </Shell>
  );
}
