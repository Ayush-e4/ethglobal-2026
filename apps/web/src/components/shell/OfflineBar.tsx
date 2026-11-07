"use client";

import { useEffect, useState } from "react";

/**
 * A slim bar while the phone has no connection, so a stalled screen explains itself, and a
 * moment of "Back online" when it returns (screens that couldn't load try again by themselves).
 */
export function OfflineBar() {
  const [state, setState] = useState<"online" | "offline" | "back">("online");
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(t);
      if (!navigator.onLine) return setState("offline");
      setState((s) => (s === "offline" ? "back" : s));
      t = setTimeout(() => setState("online"), 2500);
    };
    if (!navigator.onLine) setState("offline");
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      clearTimeout(t);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (state === "online") return null;
  return (
    <div
      role="status"
      className={`fade-in flex items-center justify-center gap-2 px-4 py-2 text-[13px] font-semibold text-white ${state === "back" ? "bg-ok" : "bg-ink"}`}
    >
      <span
        aria-hidden
        className={`size-2 rounded-full ${state === "back" ? "bg-white" : "bg-saffron"}`}
      />
      {state === "back"
        ? "Back online."
        : "You're offline. Paying, chatting and anything new need a connection."}
    </div>
  );
}
