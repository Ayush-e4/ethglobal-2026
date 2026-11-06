import { useRef } from "react";
import { UndoIcon } from "../icons";

/**
 * The undo window as a ring that drains, second by second, around the undo arrow. With the
 * window's length (`total`), a chat reopened halfway shows it half drained.
 */
export function UndoRing({ secs, total }: { secs: number; total?: number }) {
  const most = useRef(secs);
  if (secs > most.current) most.current = secs;
  const whole = total && total >= secs ? total : most.current;
  const left = whole > 0 ? secs / whole : 0;
  return (
    <span className="relative flex size-6 items-center justify-center" aria-hidden>
      <svg
        viewBox="0 0 24 24"
        className="absolute inset-0 -rotate-90"
        width={24}
        height={24}
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r="10.5"
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeWidth={2}
        />
        <circle
          cx="12"
          cy="12"
          r="10.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - left}
          className="transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
      </svg>
      <UndoIcon size={12} />
    </span>
  );
}
