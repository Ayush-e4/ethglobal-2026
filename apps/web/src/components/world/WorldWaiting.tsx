"use client";

import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import type { WorldCheck } from "@/lib/api";

export const worldButton =
  "flex min-h-11 items-center justify-center rounded-xl bg-teal px-5 text-sm font-semibold text-white disabled:opacity-60";

/**
 * A World ID check waiting for the person: the code to match, and a way to World's page for it
 * (a QR code to scan with a phone on a laptop, a button on a phone), which opens the World ID app.
 * It can be approved on another device: on a phone without World's (test) app, say an Android
 * phone while the sandbox app is iPhone-only, the QR shows on request for that device to scan.
 */
export function WorldWaiting({ check }: { check: WorldCheck }) {
  const [qr, setQr] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-line bg-white p-4 text-sm">
      <QRCodeSVG
        value={check.link}
        size={148}
        marginSize={1}
        className={qr ? "block" : "hidden sm:block"}
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
        <span className="flex flex-wrap gap-2">
          <a
            className={`${worldButton} self-start`}
            href={check.link}
            target="_blank"
            rel="noreferrer"
          >
            Open World ID
          </a>
          {!qr && (
            <button
              type="button"
              onClick={() => setQr(true)}
              className="flex min-h-11 items-center rounded-xl border border-line-2 bg-white px-4 text-sm font-semibold text-teal sm:hidden"
            >
              Approve on another device
            </button>
          )}
        </span>
        {qr && (
          <span className="text-xs text-ink-3 sm:hidden">
            Scan the QR with the phone or tablet that has the World ID app, and approve there: this
            page finishes by itself.
          </span>
        )}
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
      Needs the World ID app. This test build uses World's sandbox (test identities; its app is on
      iPhone and iPad): on Android, approve from one of those with Approve on another device.
    </span>
  );
}
