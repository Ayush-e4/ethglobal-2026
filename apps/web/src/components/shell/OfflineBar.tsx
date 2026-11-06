"use client";

import { useEffect, useState } from "react";

/** A slim bar while the phone has no connection, so a stalled screen explains itself. */
export function OfflineBar() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline) return null;
  return (
    <div
      role="status"
      className="fade-in flex items-center justify-center gap-2 bg-ink px-4 py-2 text-[13px] font-semibold text-white"
    >
      <span aria-hidden className="size-2 rounded-full bg-saffron" />
      You&apos;re offline. Payments and replies wait until you&apos;re back.
    </div>
  );
}
