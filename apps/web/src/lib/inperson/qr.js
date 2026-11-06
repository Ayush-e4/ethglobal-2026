/**
 * A QR code as a grid of modules, and its picture.
 *
 * Dark and light are kept off pure black and white (30 and 235 of 255) so the hidden layer has
 * room to push colours both ways without clipping (it moves them by a few levels).
 */
import QRCode from "qrcode";

export const LEVELS = Object.freeze({ dark: 30, light: 235 });

/** Bytes → { n, dark(row, col) }. Byte mode, error correction M (15% of the code can be lost). */
export function makeQR(bytes, ecc = "M") {
  const q = QRCode.create([{ data: bytes, mode: "byte" }], { errorCorrectionLevel: ecc });
  const n = q.modules.size;
  return { n, version: q.version, dark: (r, c) => Boolean(q.modules.get(r, c)) };
}

/**
 * The QR drawn at `modulePx` per module with a `quiet`-module light border.
 * Returns RGBA bytes plus where the code itself sits (for the hidden layer's tiles).
 */
export function renderQR(
  qr,
  { modulePx = 12, quiet = 4, dark = LEVELS.dark, light = LEVELS.light } = {},
) {
  const size = (qr.n + 2 * quiet) * modulePx;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    const my = Math.floor(y / modulePx) - quiet;
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / modulePx) - quiet;
      const isDark = mx >= 0 && my >= 0 && mx < qr.n && my < qr.n && qr.dark(my, mx);
      const v = isDark ? dark : light;
      const i = (y * size + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }
  const start = quiet * modulePx;
  return { size, rgba, code: { x: start, y: start, size: qr.n * modulePx }, modulePx, quiet };
}
