"use client";

import { useEffect, useState } from "react";

type InstallPrompt = Event & { prompt: () => Promise<void> };

/** Registers the service worker (https, or this machine while developing). */
export function PwaRegister() {
  useEffect(() => {
    const local = ["localhost", "127.0.0.1"].includes(location.hostname);
    if (!("serviceWorker" in navigator) || (location.protocol !== "https:" && !local)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}

const DISMISSED = "shikigami:install-card";

/**
 * On a phone's browser (not yet installed): a card that sells the app in one line and installs
 * it. Android: Chrome's own prompt, one tap. iPhone: the two steps, with Safari's share icon.
 * "Not now" hides it on this device.
 */
export function InstallCard() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [ios, setIos] = useState(false);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    try {
      if (localStorage.getItem(DISMISSED)) return;
    } catch {}
    const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent);
    setIos(iphone);
    setShow(iphone);
    const keep = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
      setShow(true);
    };
    const done = () => setShow(false);
    window.addEventListener("beforeinstallprompt", keep);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", keep);
      window.removeEventListener("appinstalled", done);
    };
  }, []);
  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {}
  };
  return (
    <section
      aria-label="Install the app"
      className="fade-in flex items-start gap-3 rounded-2xl border border-line bg-teal-tint p-4 md:hidden"
    >
      <span aria-hidden className="size-11 flex-none rounded-xl bg-[url(/icon-192.png)] bg-cover" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[15px] font-bold">Get Shikigami as an app</span>
        {ios && !prompt ? (
          <span className="text-[13px] leading-snug text-ink-3">
            Full screen, with Face ID. In Safari, tap <span className="sr-only">Share</span>
            <span className="inline-flex translate-y-0.5 text-teal" aria-hidden="true">
              <svg viewBox="0 0 24 24" width={16} height={16} fill="none" aria-hidden="true">
                <path
                  d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"
                  stroke="currentColor"
                  strokeWidth={1.9}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>{" "}
            then <b>Add to Home Screen</b>.
          </span>
        ) : (
          <span className="text-[13px] leading-snug text-ink-3">
            Full screen, on your home screen, with Face ID or your fingerprint.
          </span>
        )}
        <div className="flex gap-2 pt-1">
          {prompt && (
            <button
              type="button"
              onClick={() => void prompt.prompt()}
              className="press min-h-10 rounded-xl bg-teal px-4 text-sm font-semibold text-white"
            >
              Install
            </button>
          )}
          <button
            type="button"
            onClick={dismiss}
            className="min-h-10 rounded-xl px-3 text-sm font-semibold text-ink-3"
          >
            Not now
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * "Install app": Chrome and Android offer it as a prompt; iPhones need Share → Add to Home
 * Screen, so they get the hint instead. Hidden once it's installed (opened as the app).
 */
export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [ios, setIos] = useState(false);
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    setIos(/iPhone|iPad|iPod/.test(navigator.userAgent));
    const keep = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const done = () => setPrompt(null);
    window.addEventListener("beforeinstallprompt", keep);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", keep);
      window.removeEventListener("appinstalled", done);
    };
  }, []);
  if (!prompt && !ios) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => (prompt ? void prompt.prompt() : setHint((h) => !h))}
        className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-white px-3 text-sm font-semibold text-teal hover:border-teal"
      >
        <span aria-hidden className="size-5 rounded-md bg-[url(/icon-192.png)] bg-cover" />
        Install the app
      </button>
      {hint && (
        <p className="px-1 text-xs text-muted">
          In Safari, tap Share, then <b>Add to Home Screen</b>.
        </p>
      )}
    </div>
  );
}
