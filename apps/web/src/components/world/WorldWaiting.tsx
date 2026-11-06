"use client";

import { QRCodeSVG } from "qrcode.react";
import type { WorldCheck } from "@/lib/api";

export const worldButton =
  "flex min-h-11 items-center justify-center rounded-xl bg-teal px-5 text-sm font-semibold text-white disabled:opacity-60";

/**
 * A World ID check waiting for the person: the code to match, and a way to World's page for it
 * (a QR code to scan with a phone on a laptop, a button on a phone), which opens the World ID app.
 */
export function WorldWaiting({ check }: { check: WorldCheck }) {
  return (
    <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-line bg-white p-4 text-sm">
      <QRCodeSVG
        value={check.link}
        size={148}
        marginSize={1}
        className="hidden sm:block"
        aria-label="QR code to approve with World ID"
      />
      <div className="flex min-w-[220px] flex-1 flex-col gap-2">
        <span className="text-ink-3">
          <span className="sm:hidden">
            Tap Open World ID, approve in the World ID app, then come back to World's page: that
            finishes it.
          </span>
          <span className="hidden sm:inline">
            Scan this with your phone (or open World's page), approve in the World ID app, then go
            back to World's page: that finishes it.
          </span>{" "}
          Check the code matches:
        </span>
        <span className="font-mono text-2xl font-bold tracking-widest">{check.userCode}</span>
        <a
          className={`${worldButton} self-start`}
          href={check.link}
          target="_blank"
          rel="noreferrer"
        >
          Open World ID
        </a>
        <span role="status" className="flex items-center gap-2 text-xs text-muted">
          <span className="size-2 animate-pulse rounded-full bg-saffron" />
          Waiting for your approval, until{" "}
          {new Date(check.expiresAt).toLocaleTimeString("en-IN", { timeStyle: "short" })}
        </span>
      </div>
    </div>
  );
}

/** The line under every World ID card: what it needs, honestly. */
export function WorldNote() {
  return (
    <span className="text-xs text-muted">
      Needs the World ID app. This test build uses World's sandbox, with test identities.
    </span>
  );
}
