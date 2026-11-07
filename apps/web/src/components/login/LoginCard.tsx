"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { cancelled, passkeysSupported, signInWithPasskey, signUpWithPasskey } from "@/lib/passkey";
import { safeNext } from "@/lib/safe-next";
import { PasskeyIcon } from "../icons";

const primary =
  "flex min-h-[52px] w-full flex-col items-center justify-center gap-0.5 rounded-xl bg-teal px-5 py-2 text-white hover:bg-teal-dark disabled:opacity-60";
const secondary =
  "flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-line-2 bg-white text-[15px] font-semibold disabled:opacity-60";

/** New here: make a passkey (that's the account). Been here: sign in with it. Or try the demo. */
export function LoginCard() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [supported, setSupported] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setSupported(passkeysSupported()), []);

  // Only paths inside the app (never "//elsewhere"), so the link can't send people off-site.
  const done = () => router.replace(safeNext(next, window.location.origin));
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      done();
    } catch (err) {
      setError(
        cancelled(err)
          ? "The passkey prompt was closed. Try again when you're ready."
          : err instanceof ApiError && /user verification/i.test(err.message)
            ? "Your passkey app didn't confirm it's you (Face ID, fingerprint or PIN). Try again, and when asked where to save the passkey, pick this Mac's or your phone's."
            : err instanceof ApiError
              ? err.status === 0 || err.status === 429 || err.status >= 500
                ? err.message // offline, too many tries, our side: the words say it all
                : `Sign-in didn't work: ${err.message}`
              : "This device couldn't use a passkey. Try your phone, or the demo.",
      );
      setBusy(false);
    }
  };

  return (
    <section aria-label="Sign in" className="flex w-full max-w-[440px] flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-bold tracking-tight">Sign in</h1>
        <p className="text-[15px] text-ink-3">
          No password and no wallet to install: your device is your key.
        </p>
      </div>
      {supported ? (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            className={primary}
            disabled={busy}
            onClick={() => run(signUpWithPasskey)}
          >
            <span className="flex items-center gap-2 text-[15px] font-semibold">
              <PasskeyIcon size={20} /> Create an account with a passkey
            </span>
            <span className="text-xs text-[#D7E8EA]">Face ID, fingerprint or your phone</span>
          </button>
          <button
            type="button"
            className={secondary}
            disabled={busy}
            onClick={() => run(signInWithPasskey)}
          >
            I have a passkey: sign in
          </button>
        </div>
      ) : (
        <p className="rounded-xl bg-side px-4 py-3 text-sm text-ink-3">
          This browser can't use passkeys. Open Shikigami in Safari, Chrome or Edge, or try the
          demo.
        </p>
      )}
      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>
      <button
        type="button"
        className={secondary}
        disabled={busy}
        onClick={() => run(() => api("/auth/demo", { method: "POST" }))}
      >
        Try the demo
      </button>
      <p className="text-center text-xs text-muted">
        The demo pays agents from a shared test wallet, with a daily cap.
      </p>
      {error && (
        <p role="alert" className="rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}
    </section>
  );
}
