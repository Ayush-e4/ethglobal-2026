"use client";

import { useState } from "react";
import { haptic } from "@/lib/native/haptics";
import { ShareIcon } from "./icons";

/**
 * The phone's own share sheet (WhatsApp, Messages, AirDrop…) where there is one; elsewhere the
 * link is copied. Shares the current page unless given a URL.
 */
export function ShareButton({ title, text, url }: { title: string; text?: string; url?: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const link = url ?? window.location.href;
    haptic("tap");
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url: link });
      } catch {} // closed without sharing
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };
  return (
    <button
      type="button"
      onClick={share}
      className="press flex min-h-11 items-center gap-2 rounded-xl border border-line-2 bg-white px-4 text-sm font-semibold text-teal"
    >
      <ShareIcon size={17} />
      {copied ? "Link copied" : "Share"}
    </button>
  );
}
