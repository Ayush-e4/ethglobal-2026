"use client";

import { useEffect } from "react";

/**
 * The whole app broke (even the root layout). It draws its own page, without our styles, so the
 * look is inline: the same words and the same two ways on as every other error screen.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error("app crashed:", error);
  }, [error]);
  const button = {
    minHeight: 44,
    padding: "0 20px",
    borderRadius: 12,
    font: "600 14px system-ui, sans-serif",
    cursor: "pointer",
  } as const;
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          background: "#fff",
          color: "#182026",
          font: "15px/1.5 system-ui, sans-serif",
          padding: 16,
        }}
      >
        <title>Shikigami</title>
        <main style={{ maxWidth: 400, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Shikigami hit a problem</h1>
          <p style={{ color: "#4f5a63", margin: "0 0 20px" }}>
            Something went wrong on our side. Your payments and bookings are safe: they&apos;re kept
            on our server, not on this screen.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => retry()}
              style={{ ...button, border: 0, background: "#0e5a64", color: "#fff" }}
            >
              Try again
            </button>
            {/* A plain link on purpose: it loads the app afresh. */}
            <a
              href="/chat"
              style={{
                ...button,
                display: "inline-flex",
                alignItems: "center",
                border: "1px solid #d6d0c6",
                color: "#182026",
                textDecoration: "none",
              }}
            >
              Go to chat
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
