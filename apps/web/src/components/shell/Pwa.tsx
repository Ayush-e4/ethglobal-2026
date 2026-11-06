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
