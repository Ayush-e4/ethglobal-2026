"use client";

import { useEffect, useState } from "react";

/**
 * What's happening during a long wait, said plainly as time passes, with a bar that keeps moving:
 * a slow Hedera step never looks like a frozen screen. `steps` are [after seconds, what to say].
 */
export function WaitSteps({ steps }: { steps: [number, string][] }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(t);
  }, []);
  const now = steps.filter(([at]) => secs >= at).at(-1)?.[1] ?? steps[0]?.[1];
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <span className="wait-bar block h-1 overflow-hidden rounded-full bg-teal-soft" />
      <span className="text-[13px] text-ink-3">
        {now}{" "}
        <span aria-hidden className="text-muted">
          · {secs}s
        </span>
      </span>
    </div>
  );
}
