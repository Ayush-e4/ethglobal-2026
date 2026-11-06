import { counterAt, fromHex, liveCode } from "@app/shared";
import {
  AXES,
  createHiddenEncoder,
  DEFAULTS,
  layout,
  packConfig,
  payloadBits,
} from "@/lib/inperson/hidden";
import { makeQR, renderQR } from "@/lib/inperson/qr";

/**
 * The Live QR's pictures: the plain QR (the 24-byte request and the layer's settings byte), with
 * each tile's colour nudged by the hidden layer at time t. `refresh` loads the current live code
 * (call it every 100 ms); `draw(t)` paints the picture for that moment into `rgba`.
 */
export function liveFrames(frame: string, liveKey: string) {
  const c = DEFAULTS;
  const request = fromHex(frame);
  const key = fromHex(liveKey);
  const bytes = new Uint8Array(25);
  bytes.set(request);
  bytes[24] = packConfig(c);
  const img = renderQR(makeQR(bytes), { modulePx: 8 });
  const base = img.rgba;
  const rgba = new Uint8ClampedArray(base.length);
  const { tiles } = layout(c);
  const tileOf = new Int16Array(img.size * img.size).fill(-1); // which tile each pixel is in
  const ts = img.code.size / c.grid;
  for (let y = 0; y < img.code.size; y++)
    for (let x = 0; x < img.code.size; x++)
      tileOf[(img.code.y + y) * img.size + img.code.x + x] =
        Math.floor(y / ts) * c.grid + Math.floor(x / ts);
  let bits = payloadBits(new Uint8Array(8));
  const enc = createHiddenEncoder(c, () => bits);
  const axis = AXES[c.axis as keyof typeof AXES];
  const delta = new Int16Array(tiles * 3);
  return {
    size: img.size,
    rgba,
    async refresh(ms = Date.now()) {
      bits = payloadBits(await liveCode(key, request, counterAt(ms)));
    },
    /** Paints moment t (ms); false if nothing changed since the last picture. */
    draw(t: number, last = { sig: "" }) {
      const off = enc.offsets(t);
      for (let k = 0; k < tiles; k++)
        for (let ch = 0; ch < 3; ch++) delta[k * 3 + ch] = Math.round(off[k] * axis[ch]);
      const sig = delta.join(",");
      if (sig === last.sig) return false;
      last.sig = sig;
      for (let i = 0, p = 0; i < tileOf.length; i++, p += 4) {
        const k = tileOf[i] ?? -1;
        rgba[p] = base[p] + (k < 0 ? 0 : delta[k * 3]);
        rgba[p + 1] = base[p + 1] + (k < 0 ? 0 : delta[k * 3 + 1]);
        rgba[p + 2] = base[p + 2] + (k < 0 ? 0 : delta[k * 3 + 2]);
        rgba[p + 3] = 255;
      }
      return true;
    },
  };
}
