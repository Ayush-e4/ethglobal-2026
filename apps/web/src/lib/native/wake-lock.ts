"use client";

import { useEffect } from "react";

/**
 * Keeps the screen on while `active` (Screen Wake Lock: Android, and iPhones from iOS 18.4).
 * The lock drops when the page is hidden, so it's taken again when the page comes back.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let done = false;
    const take = async () => {
      try {
        if (document.visibilityState !== "visible" || done) return;
        const got = await navigator.wakeLock.request("screen");
        if (done)
          void got.release().catch(() => {}); // no longer wanted by the time it came
        else lock = got;
      } catch {}
    };
    const onVisible = () => void take();
    void take();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      done = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
