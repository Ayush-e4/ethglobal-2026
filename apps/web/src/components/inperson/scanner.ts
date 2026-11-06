import { toHex } from "@app/shared";
import jsQR from "jsqr";
import { codeToImage, sampleTiles } from "@/lib/inperson/geometry";
import { createHiddenDecoder, unpackConfig } from "@/lib/inperson/hidden";

type Session = {
  request: string;
  grid: number;
  dec: ReturnType<typeof createHiddenDecoder> | null;
};

/**
 * Reads camera pictures: finds a Shikigami payment QR (jsQR), then follows its hidden layer and
 * hands over each live code it decodes (the server says if it's genuine and current). From the
 * Live QR lab, where it confirmed a live screen in 1.4 to 2.4 s.
 */
export function createScanner(on: {
  request: (frameHex: string, hasLiveLayer: boolean) => void;
  live: (codeHex: string) => void;
}) {
  let loc: Parameters<typeof codeToImage>[0] | null = null;
  let lastSeen = Number.NEGATIVE_INFINITY;
  let session: Session | null = null;
  let n = 0;
  let liveDone = false;

  const start = (raw: number[] | Uint8ClampedArray) => {
    const b = Uint8Array.from(raw);
    if (b.length !== 24 && b.length !== 25) return; // not one of ours
    const request = toHex(b.subarray(0, 24));
    if (session?.request === request) return;
    const cfg = b.length === 25 ? unpackConfig(b[24] ?? 0) : null;
    session = {
      request,
      grid: cfg?.grid ?? 4,
      dec: cfg ? createHiddenDecoder({ ...cfg, amplitude: 1 } as never) : null,
    };
    liveDone = false;
    on.request(request, !!cfg);
  };

  return {
    /** The payer's server check passed: stop reading the layer. */
    liveConfirmed() {
      liveDone = true;
    },
    /** One camera picture, taken at tMs. */
    frame(img: ImageData, tMs: number) {
      n++;
      if (!loc || n % 6 === 0) {
        const q = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        if (q) {
          loc = q.location;
          lastSeen = n;
          start(q.binaryData);
        } else if (n - lastSeen > 30) loc = null; // lost it for a second
      }
      const dec = session?.dec;
      if (!dec || !loc || liveDone) return;
      const m = sampleTiles(img, codeToImage(loc), session?.grid ?? 4);
      dec.push(tMs, m.tiles, m.refs);
      if (n % 3 === 0) {
        const got = dec.decode();
        if (got) on.live(toHex(got.payload)); // junk fails the server's check and is ignored
      }
    },
  };
}
