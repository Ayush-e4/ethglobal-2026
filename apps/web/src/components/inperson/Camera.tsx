"use client";

import { useEffect, useRef } from "react";
import { backCamera } from "./back-camera";
import { createScanner } from "./scanner";

/**
 * The phone's back camera, full width, read frame by frame for a payment QR and its live layer.
 * Stops the camera when it unmounts.
 */
export function Camera(p: {
  onRequest: (frameHex: string, hasLiveLayer: boolean) => void;
  onLive: (codeHex: string) => void;
  onError: (message: string) => void;
  scanner: React.MutableRefObject<ReturnType<typeof createScanner> | null>;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const cb = useRef(p);
  cb.current = p;
  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    const work = document.createElement("canvas");
    const wctx = work.getContext("2d", { willReadFrequently: true });
    const scanner = createScanner({
      request: (f, live) => cb.current.onRequest(f, live),
      live: (c) => cb.current.onLive(c),
    });
    cb.current.scanner.current = scanner;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia)
        return cb.current.onError("The camera needs the app's https address.");
      try {
        stream = await backCamera(); // a back lens that can focus at 20–40 cm
      } catch {
        return cb.current.onError("Allow the camera to scan, then try again.");
      }
      const v = video.current;
      if (!v || stopped) return;
      v.srcObject = stream;
      await v.play().catch(() => {});
      let lastT = -1;
      const process = (_now: number, meta?: { mediaTime?: number }) => {
        if (stopped) return;
        if (v.videoWidth && wctx) {
          const w = 480;
          const h = Math.round((w * v.videoHeight) / v.videoWidth);
          if (work.width !== w || work.height !== h) [work.width, work.height] = [w, h];
          const t = (meta?.mediaTime ?? v.currentTime) * 1000;
          if (t !== lastT) {
            lastT = t;
            wctx.drawImage(v, 0, 0, w, h);
            scanner.frame(wctx.getImageData(0, 0, w, h), t);
          }
        }
        next();
      };
      const next = () =>
        v.requestVideoFrameCallback
          ? v.requestVideoFrameCallback(process)
          : requestAnimationFrame((n) => process(n));
      next();
    })();
    return () => {
      stopped = true;
      for (const t of stream?.getTracks() ?? []) t.stop();
    };
  }, []);
  return (
    <div className="relative overflow-hidden rounded-2xl bg-ink">
      <video ref={video} muted playsInline className="aspect-[3/4] w-full object-cover" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-white/80"
      />
      <p className="absolute inset-x-0 bottom-3 text-center text-sm font-semibold text-white">
        Point at the shop&apos;s QR, 20–40 cm away
      </p>
    </div>
  );
}
