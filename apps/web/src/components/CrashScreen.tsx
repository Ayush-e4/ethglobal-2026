"use client";

import Link from "next/link";
import { useEffect } from "react";
import { friendly, OUR_SIDE } from "@/lib/errors";
import { LoadError, quietButton } from "./LoadError";

/**
 * A screen that broke while drawing (a bug, not a failed request): say so plainly, keep the
 * reference that matches our server's log, and offer the way on. Nothing is lost by it: money
 * only moves on the server, and every payment has its own record.
 */
export function CrashScreen({
  error,
  retry,
  home = "/chat",
}: {
  error: unknown;
  retry: () => void;
  home?: string;
}) {
  useEffect(() => {
    console.error("screen crashed:", error);
  }, [error]);
  const digest =
    error instanceof Error && "digest" in error && typeof error.digest === "string"
      ? error.digest
      : null;
  const said = friendly(error, "");
  return (
    <main className="flex min-h-[60dvh] flex-col items-center justify-center px-4">
      <LoadError
        title="This screen hit a problem"
        error={`${said || OUR_SIDE} Your payments and bookings are safe: they're kept on our server, not on this screen.`}
        onRetry={retry}
      >
        <Link href={home} replace className={quietButton}>
          {home === "/" ? "Go to the home page" : "Go to chat"}
        </Link>
      </LoadError>
      {digest && <p className="font-mono text-xs text-muted">Reference {digest}</p>}
    </main>
  );
}
