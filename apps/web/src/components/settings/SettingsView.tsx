"use client";

import Link from "next/link";
import { useSession } from "@/lib/session";
import { ExitIcon, PasskeyIcon, WalletIcon } from "../icons";
import { Alerts } from "../wallet/Alerts";
import { ConnectedApps } from "../wallet/ConnectedApps";
import { Devices } from "../wallet/Devices";
import { EmailSettings } from "../wallet/EmailSettings";
import { Travellers } from "../wallet/Travellers";

const ABOUT = [
  { href: "/security", label: "Security" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/status", label: "Status" },
  { href: "/docs", label: "Developer docs" },
];

/** Your account: who you are here, alerts, who you book for, connected apps and devices. */
export function SettingsView() {
  const { me, signOut } = useSession();
  if (!me) return <p className="p-10 text-center text-muted">Loading your settings…</p>;
  const name = me.displayName ?? "You";

  return (
    <main className="mx-auto flex w-full max-w-[800px] flex-col gap-6 px-4 pt-6 pb-14 sm:px-6 sm:pt-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] font-bold tracking-tight sm:text-[32px]">Settings</h1>
        <p className="text-[15px] leading-relaxed text-ink-3">
          Your account, where alerts go, the people you book for, and the apps and devices that can
          use Shikigami for you. Money and spending limits are in{" "}
          <Link href="/wallet" className="font-semibold text-teal underline underline-offset-2">
            Wallet
          </Link>
          .
        </p>
      </div>

      <section
        aria-label="Your account"
        className="flex flex-wrap items-center gap-4 rounded-2xl border border-line p-4"
      >
        <span
          aria-hidden
          className="flex size-12 flex-none items-center justify-center rounded-full bg-teal-soft text-lg font-bold text-teal"
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-lg font-semibold">{name}</span>
          <span className="flex items-center gap-1.5 text-sm text-ink-3">
            {me.isDemo ? (
              <>
                <WalletIcon size={15} className="flex-none" /> Demo account
              </>
            ) : (
              <>
                <PasskeyIcon size={15} className="flex-none" /> Passkey account
              </>
            )}
          </span>
        </span>
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex min-h-11 items-center gap-2 rounded-xl border border-line-2 bg-white px-4 text-sm font-semibold"
        >
          <ExitIcon size={16} /> Sign out
        </button>
      </section>
      {me.isDemo && (
        <p className="rounded-2xl bg-side px-4 py-3 text-sm leading-relaxed text-ink-3">
          A demo account is throwaway: it holds no personal data and gets no email. For your own
          wallet, sign out and create an account with a passkey.
        </p>
      )}

      <Alerts />
      <EmailSettings />
      <Travellers />
      <ConnectedApps />
      {!me.isDemo && <Devices />}

      <nav aria-label="About Shikigami" className="flex flex-wrap gap-x-5 gap-y-2 pt-2 text-sm">
        {ABOUT.map((a) => (
          <Link key={a.href} href={a.href} className="text-ink-3 underline underline-offset-2">
            {a.label}
          </Link>
        ))}
      </nav>
    </main>
  );
}
