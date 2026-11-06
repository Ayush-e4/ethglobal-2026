"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, hashscanAccount, shortAddress, usdc, type WalletInfo } from "@/lib/api";
import { PasskeyIcon, SettingsIcon } from "../icons";
import { CardSkeleton } from "../Skeleton";
import { DealDrop } from "./DealDrop";
import { Limits } from "./Limits";
import { TopUp } from "./TopUp";
import { WorldBonus } from "./WorldBonus";

/**
 * Your Face ID wallet: its test USDC and its Hedera account. Only your passkeys can move what's
 * in it; we pay the network fees. Demo accounts spend from a shared test wallet instead.
 */
export function WalletView() {
  const [info, setInfo] = useState<WalletInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<WalletInfo>("/wallet")
        .then((w) => {
          setInfo(w);
          setError(null);
        })
        .catch(() => setError("Couldn't load your wallet.")),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // While it's being made on Hedera (a few seconds), check again.
  const making =
    !info || (!info.demo && info.wallet?.status !== "ready" && info.wallet?.status !== "failed");
  useEffect(() => {
    if (!making) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [making, load]);

  if (!info)
    return error ? (
      <p className="p-10 text-center text-muted">{error}</p>
    ) : (
      <main className="mx-auto flex w-full max-w-[800px] flex-col gap-4 px-4 pt-6 sm:px-6 sm:pt-8">
        <h1 className="text-[28px] font-bold tracking-tight sm:text-[32px]">Wallet</h1>
        <CardSkeleton label="Loading your wallet" />
        <CardSkeleton label="Loading your wallet" />
      </main>
    );
  const w = info.wallet;

  return (
    <main className="mx-auto flex w-full max-w-[800px] flex-col gap-6 px-4 pt-6 pb-14 sm:px-6 sm:pt-8">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[28px] font-bold tracking-tight sm:text-[32px]">Wallet</h1>
          <Link
            href="/settings"
            className="flex min-h-10 items-center gap-2 rounded-xl border border-line-2 bg-white px-3.5 text-sm font-semibold"
          >
            <SettingsIcon size={16} /> Settings
          </Link>
        </div>
        <p className="text-[15px] leading-relaxed text-ink-3">
          {info.demo
            ? "This demo account spends from a shared test wallet, with a small daily allowance."
            : "Your own wallet on Hedera. Only your Face ID can move what's in it: agents are paid only through limits you approve, and we pay the network fees."}
        </p>
      </div>

      {info.demo ? (
        <section className="flex flex-col gap-2 rounded-2xl border border-line p-4 text-sm leading-relaxed text-ink-3">
          <span className="font-semibold text-ink">Want your own wallet?</span>
          Sign out and create an account with a passkey (Face ID, a fingerprint or your phone). You
          get a wallet only you control, with a little test USDC to start.
        </section>
      ) : !w || w.status === "creating" ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-2xl bg-side px-4 py-4 text-sm text-ink-3"
        >
          <span className="size-2 animate-pulse rounded-full bg-saffron" />
          Making your wallet on Hedera. This takes a few seconds.
        </p>
      ) : w.status === "failed" ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-bad-soft px-4 py-4 text-sm">
          <span>Making your wallet didn't work this time.</span>
          <button
            type="button"
            onClick={() => void load()}
            className="flex min-h-10 max-md:min-h-11 items-center rounded-xl border border-line-2 bg-white px-4 font-semibold"
          >
            Try again
          </button>
        </section>
      ) : (
        <>
          <section
            aria-label="Your wallet"
            className="flex flex-wrap items-center gap-4 rounded-[18px] bg-teal px-5 py-[18px] text-white"
          >
            <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1">
              <span className="flex items-center gap-2 font-mono text-base">
                <PasskeyIcon size={16} /> Face ID wallet · {shortAddress(w.address)}
              </span>
              <span className="text-[13px] text-[#BFDCDF]">
                {w.hederaId ? (
                  <>
                    Hedera account{" "}
                    <a
                      className="font-mono text-white underline"
                      href={hashscanAccount(w.hederaId)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {w.hederaId}
                    </a>{" "}
                    · testnet
                  </>
                ) : (
                  "Hedera testnet"
                )}
              </span>
            </div>
            <dl className="flex flex-wrap gap-7">
              {[
                ["Test USDC", w.usdcUnits ? usdc(w.usdcUnits) : "—"],
                ["Network fees", "on us"],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col gap-0.5">
                  <dt className="text-xs text-[#BFDCDF]">{k}</dt>
                  <dd className="text-2xl font-bold">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          {w.giftUnits && (
            <p className="text-sm text-ink-3">
              It started with {usdc(w.giftUnits)} test USDC from us, to try things out.
            </p>
          )}
          <WorldBonus onBonus={load} />
          <DealDrop />
          <Limits />
          <TopUp address={w.address} />
        </>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
    </main>
  );
}
