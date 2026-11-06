import { useRef } from "react";
import { UndoIcon } from "../icons";

/** The undo window as a ring that drains, second by second, around the undo arrow. */
export function UndoRing({ secs }: { secs: number }) {
  const total = useRef(secs);
  if (secs > total.current) total.current = secs;
  const left = total.current > 0 ? secs / total.current : 0;
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
