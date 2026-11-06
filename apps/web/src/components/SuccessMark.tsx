"use client";

import { useEffect, useRef } from "react";
import { celebrate } from "@/lib/native/celebrate";

/**
 * The moment money lands: a coin pops and turns over into a green tick that draws itself, a
 * ripple goes out, and (with `burst`) the WebGL confetti flies from it. Reduced motion: the tick
 * is simply there.
 */
export function SuccessMark({ size = 72, burst = true }: { size?: number; burst?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!burst) return;
    const t = setTimeout(() => celebrate(ref.current), 260);
    return () => clearTimeout(t);
  }, [burst]);
  return (
    <span
      ref={ref}
      className="success-mark relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <span aria-hidden className="success-ripple absolute inset-0 rounded-full" />
      <span className="success-coin flex size-full items-center justify-center rounded-full text-white">
        <svg
          viewBox="0 0 24 24"
          width={size * 0.5}
          height={size * 0.5}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path className="success-tick" d="M20 6 9 17l-5-5" pathLength={1} />
        </svg>
      </span>
    </span>
  );
}
