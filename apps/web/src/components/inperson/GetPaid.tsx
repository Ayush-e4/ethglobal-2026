"use client";

import { fromHex } from "@app/shared";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, hashscanTx } from "@/lib/api";
import { useBackToClose } from "@/lib/native/back";
import { haptic } from "@/lib/native/haptics";
import { useWakeLock } from "@/lib/native/wake-lock";
import { useSession } from "@/lib/session";
import { CardSkeleton } from "../Skeleton";
import { SuccessMark } from "../SuccessMark";
import { LiveQr } from "./LiveQr";
import { chirp, preloadSound } from "./sound";

type Merchant = { name: string; account: string; verified: boolean };
type Req = { id: string; frame: string; liveKey: string; inr: number; expiresAt: string };
type Status = {
  status: "open" | "paying" | "paid" | "expired";
  payTx: string | null;
  live: boolean | null;
};
const PICKS = [20, 40, 100, 250];
const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const btn = "flex min-h-12 items-center justify-center rounded-xl px-5 text-[15px] font-semibold";

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
  const quiet = () => {
    speaker.current?.stop();
    speaker.current = null;
    setChirping(false);
  };
  useEffect(() => {
    preloadSound();
    return () => speaker.current?.stop();
  }, []);
  // Paid, expired or a new request: the chirp stops.
  useEffect(() => {
    if (req && status?.status !== "paid" && status?.status !== "expired" && left !== 0) return;
    speaker.current?.stop();
    speaker.current = null;
    setChirping(false);
  }, [req, status?.status, left]);
  /** The request as sound too, for a payer who'd rather listen (started from this tap). */
  const toggleChirp = async () => {
    if (speaker.current) return quiet();
    if (!req) return;
    try {
      speaker.current = await chirp(fromHex(req.frame));
      setChirping(true);
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
  const paidNow = status?.status === "paid";
  useEffect(() => {
    if (paidNow) haptic("success");
  }, [paidNow]);

  useEffect(() => {
    api<{ merchant: Merchant | null }>("/merchant")
      .then((r) => setMerchant(r.merchant))
      .catch(() => setMerchant(null));
  }, []);

  // While the QR is up: is it paid yet, and how long it has left.
  useEffect(() => {
    if (!req) return;
    const end = new Date(req.expiresAt).getTime();
    const t = setInterval(async () => {
      setLeft(Math.max(0, Math.round((end - Date.now()) / 1000)));
      const s = await api<Status>(`/merchant/requests/${req.id}`).catch(() => null);
      if (s) setStatus(s);
      if (s?.status === "paid" || s?.status === "expired") clearInterval(t);
    }, 1500);
    return () => clearInterval(t);
  }, [req]);

  const fail = (e: unknown) =>
    setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
  const setUp = () =>
    api<{ merchant: Merchant }>("/merchant", { method: "POST", body: { name } })
      .then((r) => setMerchant(r.merchant))
      .catch(fail);
  const ask = () => {
    setError(null);
    setStatus(null);
    api<Req>("/merchant/requests", { method: "POST", body: { inr: Number(inr) } })
      .then((r) => {
        setReq(r);
        setLeft(Math.round((new Date(r.expiresAt).getTime() - Date.now()) / 1000));
      })
      .catch(fail);
  };

  if (merchant === undefined)
    return (
      <div className="mx-auto w-full max-w-[520px] p-4 sm:p-6">
        <CardSkeleton label="Loading your shop" />
      </div>
    );
  if (!merchant)
    return (
      <Shell title="Get paid in person">
        {me?.isDemo ? (
          <>
            <p className="text-sm text-ink-2">
              Getting paid goes into your own Face ID wallet. Sign in with a passkey to set it up; a
              demo account can still <b>pay</b> a shop.
            </p>
            <Link href="/pay" replace className={`${btn} press bg-teal text-white`}>
              Pay a shop instead
            </Link>
          </>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void setUp();
            }}
          >
            <p className="text-sm text-ink-2">
              Customers pay you by scanning a QR on this screen. The money goes to your Face ID
              wallet on Hedera. One real person per shop: you verify with World ID once, and your
              shop&apos;s name is yours alone.
            </p>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              The name customers see
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Chai Point, Bandra"
                maxLength={40}
                className="min-h-12 rounded-xl border border-line-2 px-3 text-[15px] font-normal"
              />
            </label>
            <button
              type="submit"
              disabled={name.trim().length < 2}
              className={`${btn} bg-teal text-white disabled:opacity-50`}
            >
              Start getting paid
            </button>
          </form>
        )}
        {error && <p className="text-sm text-bad">{error}</p>}
        {error?.includes("World ID") && (
          <a href="/wallet" className={`${btn} border border-line-2 bg-white text-teal`}>
            Verify with World ID in Wallet
          </a>
        )}
      </Shell>
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
                {chirping ? "Chirping… tap to stop" : "Play the chirp too"}
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
            className="min-h-10 rounded-full border border-line-2 bg-white px-4 text-sm font-semibold"
          >
            {rupees(p)}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={ask}
        disabled={!Number(inr)}
        className={`${btn} bg-teal text-white disabled:opacity-50`}
      >
        Show payment QR
      </button>
      <p className="text-xs text-muted">Testnet: ₹1 is paid as 0.000001 test USDC on Hedera.</p>
      {error && <p className="text-sm text-bad">{error}</p>}
    </Shell>
  );
}

function Verified({ m }: { m: Merchant }) {
  return (
    <span className={`text-xs font-semibold ${m.verified ? "text-ok" : "text-muted"}`}>
      {m.verified ? "✓ Verified person (World ID)" : "Not verified with World ID yet"} · {m.account}
    </span>
  );
}

export function Shell({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-6">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>
        {sub}
      </div>
      {children}
    </div>
  );
}
