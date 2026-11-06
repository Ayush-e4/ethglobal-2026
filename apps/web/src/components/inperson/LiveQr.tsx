"use client";

import { useEffect, useRef } from "react";
import { liveFrames } from "./live-frames";

/**
 * A payment QR that proves it's live: any camera reads the request (the plain QR), and over it a
 * colour flicker too faint to see carries a code that changes every 250 ms, made with this
 * request's live key. A sticker or a screenshot can't show the current code. (Live QR lab.)
 */
export function LiveQr({ frame, liveKey }: { frame: string; liveKey: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const f = liveFrames(frame, liveKey);
    canvas.width = canvas.height = f.size;
    const out = new ImageData(f.size, f.size);
    let stopped = false;
    void f.refresh();
    const timer = setInterval(() => void f.refresh(), 100);
    const last = { sig: "" };
    let raf = 0;
    const paint = (t: number) => {
      if (stopped) return;
      if (f.draw(t, last)) {
        out.data.set(f.rgba);
        ctx.putImageData(out, 0, 0);
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      clearInterval(timer);
    };
  }, [frame, liveKey]);
  return (
    <canvas
      ref={ref}
      aria-label="Payment QR"
      className="aspect-square w-full max-w-[300px] rounded-xl [image-rendering:pixelated]"
    />
  );
}
