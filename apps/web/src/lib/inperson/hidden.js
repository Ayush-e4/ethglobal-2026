/**
 * The hidden layer: 8 bytes carried by a colour flicker over a QR code, too faint and too fast
 * for eyes, strong enough for a phone camera that averages thousands of pixels.
 *
 * The code is split into grid × grid tiles. Every tile shifts its colour by ±amplitude along one
 * colour axis, one bit at a time (Manchester: a 1 is "+ then −", a 0 is "− then +"), so each bit
 * averages to the original colour and the picture never drifts. Every frame starts with a 7-bit
 * Barker code on all tiles for timing, then the 80 data bits (8 bytes + CRC-16) spread across
 * the tiles. Frames repeat back to back.
 *
 * The default axis is blue–yellow at constant brightness: the eye's blue-yellow channel is its
 * slowest at flicker, and a camera sees it fine. A camera's own brightness changes (exposure,
 * lamp flicker, the hand moving a dark module over a light one) are all grey, so the decoder
 * measures only the part of the colour that is perpendicular to grey, which those can't touch.
 */
import { crc16 } from "@app/shared";

export const PAYLOAD_BYTES = 8;
const DATA_BITS = (PAYLOAD_BYTES + 2) * 8; // + CRC-16
export const BARKER7 = Object.freeze([1, 1, 1, -1, -1, 1, -1]);

/**
 * Colour axes, as 8-bit RGB steps per unit of amplitude. The chroma ones keep Rec.709 luma
 * (0.2126 R + 0.7152 G + 0.0722 B) the same, so brightness doesn't flicker at all.
 */
export const AXES = Object.freeze({
  "blue-yellow": [-0.0722 / 0.9278, -0.0722 / 0.9278, 1],
  "red-green": [1, -0.2126 / 0.7152, 0],
  luma: [1, 1, 1],
});

/**
 * From sim/results.md: 4×4 tiles of 100 ms bits is a 1.2 s frame, and 4 levels survives a phone's
 * leftover colour blotches up to σ ≈ 1–2 (it still moves brightness by only ~0.13%).
 */
export const DEFAULTS = Object.freeze({ grid: 4, bitMs: 100, amplitude: 4, axis: "blue-yellow" });

export function layout(cfg = DEFAULTS) {
  const tiles = cfg.grid * cfg.grid;
  const bitsPerTile = Math.ceil(DATA_BITS / tiles);
  const frameBits = BARKER7.length + bitsPerTile;
  return { tiles, bitsPerTile, frameBits, frameMs: frameBits * cfg.bitMs };
}

/** 8 bytes → the 80 bits sent (MSB first), CRC-16 included. */
export function payloadBits(payload) {
  if (payload.length !== PAYLOAD_BYTES)
    throw new RangeError(`payload must be ${PAYLOAD_BYTES} bytes`);
  const bytes = new Uint8Array(PAYLOAD_BYTES + 2);
  bytes.set(payload);
  const c = crc16(payload);
  bytes[PAYLOAD_BYTES] = c >> 8;
  bytes[PAYLOAD_BYTES + 1] = c & 0xff;
  const bits = new Uint8Array(DATA_BITS);
  for (let i = 0; i < DATA_BITS; i++) bits[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  return bits;
}

function bitsToPayload(bits) {
  const bytes = new Uint8Array(PAYLOAD_BYTES + 2);
  for (let i = 0; i < DATA_BITS; i++) bytes[i >> 3] |= bits[i] << (7 - (i & 7));
  const payload = bytes.subarray(0, PAYLOAD_BYTES);
  const ok = crc16(payload) === ((bytes[PAYLOAD_BYTES] << 8) | bytes[PAYLOAD_BYTES + 1]);
  return ok ? payload.slice() : null;
}

/**
 * Chase decoding: if the CRC fails, flip every combination of the `flips` least confident bits
 * (2^flips tries). Each try lets random junk through with chance 2^-16, so 16 tries is a 1 in
 * 4,096 false pass per failed frame, and the live code's own 32-bit tag still has to check out
 * when the payment settles.
 */
function chase(bits, confidence, flips = 4) {
  const order = [...confidence.keys()]
    .sort((a, b) => confidence[a] - confidence[b])
    .slice(0, flips);
  for (let m = 0; m < 1 << order.length; m++) {
    const tryBits = bits.slice();
    order.forEach((idx, j) => {
      if (m & (1 << j)) tryBits[idx] ^= 1;
    });
    const p = bitsToPayload(tryBits);
    if (p) return { payload: p, flipped: order.filter((_, j) => m & (1 << j)).length };
  }
  return null;
}

/**
 * The flicker to show at time t (ms): for each tile, a signed number of 8-bit levels along the
 * axis. `bitsForFrame(f)` gives frame f's 80 bits, so the payload can change frame by frame.
 * Data bit b goes to tile b mod tiles, slot ⌊b / tiles⌋.
 */
export function createHiddenEncoder(cfg = DEFAULTS, bitsForFrame) {
  const { tiles, frameBits, frameMs } = layout(cfg);
  const out = new Float32Array(tiles);
  let cachedFrame = Number.NaN; // never equal to a frame number (−1 included: times can be < 0)
  let bits = null;
  return {
    frameMs,
    offsets(tMs) {
      const f = Math.floor(tMs / frameMs);
      if (f !== cachedFrame) {
        bits = bitsForFrame(f);
        cachedFrame = f;
      }
      const p = tMs - f * frameMs;
      const k = Math.min(frameBits - 1, Math.floor(p / cfg.bitMs));
      const half = p - k * cfg.bitMs < cfg.bitMs / 2 ? 1 : -1;
      for (let t = 0; t < tiles; t++) {
        const sym =
          k < BARKER7.length ? BARKER7[k] : 2 * (bits[(k - BARKER7.length) * tiles + t] ?? 0) - 1;
        out[t] = cfg.amplitude * sym * half;
      }
      return out;
    },
  };
}

/** The unit vector a decoder measures along: the axis, minus its grey part (for chroma axes). */
export function detectionAxis(axis) {
  const a = AXES[axis];
  let v = a;
  if (axis !== "luma") {
    const g = (a[0] + a[1] + a[2]) / 3;
    v = [a[0] - g, a[1] - g, a[2] - g];
  }
  const len = Math.hypot(...v);
  return v.map((x) => x / len);
}

/**
 * Turns per-frame tile colours into payloads. push() each camera frame's tile means (and, for the
 * luma axis, a light reference from the quiet zone at the same height); decode() looks for a
 * frame in what it has and returns the 8 bytes when one passes its CRC.
 */
export function createHiddenDecoder(cfg = DEFAULTS) {
  const { tiles, bitsPerTile, frameBits, frameMs } = layout(cfg);
  const axis = detectionAxis(cfg.axis);
  const keepMs = 2 * frameMs + 6 * cfg.bitMs;
  const S = 8; // samples per bit after resampling
  const dt = cfg.bitMs / S;
  const times = [];
  const series = Array.from({ length: tiles }, () => []);
  let lastDecodedAt = -Infinity;

  function project(rgb, ref) {
    if (cfg.axis !== "luma") return rgb[0] * axis[0] + rgb[1] * axis[1] + rgb[2] * axis[2];
    const lum = (rgb[0] + rgb[1] + rgb[2]) / 3;
    const refLum = (ref[0] + ref[1] + ref[2]) / 3 || 1;
    return (lum / refLum) * 200; // brightness relative to the light border, in ~levels
  }

  function resample(tMin, n) {
    // Linear interpolation onto a uniform clock: camera frames arrive with jitter and drops.
    const out = Array.from({ length: tiles }, () => new Float32Array(n));
    let j = 0;
    for (let i = 0; i < n; i++) {
      const t = tMin + i * dt;
      while (j < times.length - 2 && times[j + 1] < t) j++;
      const t0 = times[j];
      const t1 = times[j + 1];
      const w = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
      for (let k = 0; k < tiles; k++) out[k][i] = series[k][j] * (1 - w) + series[k][j + 1] * w;
    }
    return out;
  }

  function highPass(x, win) {
    // Subtract a centred moving average over `win` samples: slow drift (exposure, white
    // balance) goes, and Manchester bits, which average to zero, stay.
    const n = x.length;
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i];
    const y = new Float32Array(n);
    const h = win >> 1;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - h);
      const b = Math.min(n, i + h + 1);
      y[i] = x[i] - (pre[b] - pre[a]) / (b - a);
    }
    return y;
  }

  // The preamble as a waveform: each Barker bit is "+ then −" times its sign, S samples per bit.
  const tmpl = new Float32Array(BARKER7.length * S);
  for (let b = 0; b < BARKER7.length; b++) {
    for (let s = 0; s < S; s++) tmpl[b * S + s] = BARKER7[b] * (s < S / 2 ? 1 : -1);
  }
  const tmplNorm = Math.sqrt(tmpl.reduce((a, v) => a + v * v, 0));

  function corrAt(x, o) {
    let dot = 0;
    let e = 0;
    for (let i = 0; i < tmpl.length; i++) {
      const v = x[o + i];
      dot += v * tmpl[i];
      e += v * v;
    }
    return e > 0 ? dot / (Math.sqrt(e) * tmplNorm) : 0;
  }

  return {
    layout: { tiles, bitsPerTile, frameBits, frameMs },

    push(tMs, tileRgb, refRgb) {
      times.push(tMs);
      for (let k = 0; k < tiles; k++) series[k].push(project(tileRgb[k], refRgb?.[k]));
      while (times.length > 2 && times[times.length - 1] - times[0] > keepMs) {
        times.shift();
        for (const s of series) s.shift();
      }
    },

    /** @returns {{ payload: Uint8Array, score: number, at: number } | null} */
    decode() {
      if (times.length < 8) return null;
      const tMin = times[0];
      const n = Math.floor((times[times.length - 1] - tMin) / dt);
      const need = frameBits * S;
      if (n < need + 2 * S) return null;
      const x = resample(tMin, n).map((s) => highPass(s, 3 * S));
      const sum = new Float32Array(n);
      for (const s of x) for (let i = 0; i < n; i++) sum[i] += s[i];

      // Candidate frame starts: preamble correlation peaks, best first. Real frames score
      // 0.77–0.87 in the simulation; noise rarely passes 0.6, and bit flipping (which multiplies
      // the chances junk passes the CRC) is only tried above 0.7.
      const cands = [];
      for (let o = 0; o + need <= n; o++) {
        const c = corrAt(sum, o);
        if (c > 0.6) cands.push([c, o]);
      }
      cands.sort((a, b) => b[0] - a[0]);
      const tried = [];
      for (const [score, o] of cands.slice(0, 12)) {
        if (tried.some((t) => Math.abs(t - o) < S / 2)) continue; // same peak
        tried.push(o);
        const at = tMin + o * dt;
        if (at <= lastDecodedAt + frameMs / 2) continue; // this frame is already out
        const bits = new Uint8Array(bitsPerTile * tiles);
        const conf = new Float32Array(bitsPerTile * tiles);
        for (let k = 0; k < tiles; k++) {
          // Each tile finds its own exact start near the shared one: rolling shutters expose
          // the top of the picture a few ms before the bottom.
          let best = o;
          let bestC = -Infinity;
          for (let d = -3; d <= 3; d++) {
            const oo = o + d;
            if (oo < 0 || oo + need > n) continue;
            const c = corrAt(x[k], oo);
            if (c > bestC) [bestC, best] = [c, oo];
          }
          for (let j = 0; j < bitsPerTile; j++) {
            const base = best + (BARKER7.length + j) * S;
            let a = 0;
            for (let s = 0; s < S; s++) a += x[k][base + s] * (s < S / 2 ? 1 : -1);
            bits[j * tiles + k] = a > 0 ? 1 : 0;
            conf[j * tiles + k] = Math.abs(a);
          }
        }
        const got = chase(
          bits.subarray(0, DATA_BITS),
          conf.subarray(0, DATA_BITS),
          score > 0.7 ? 4 : 0,
        );
        if (got) {
          lastDecodedAt = at;
          return { payload: got.payload, score, at, flipped: got.flipped };
        }
      }
      return null;
    },
  };
}
/**
 * The hidden layer's settings ride in one byte after the 24-byte request (a 25-byte QR), so the
 * scanner never has to be told: bits 0–1 axis, 2–3 grid, 4–5 bit length.
 */
const AXIS_IDS = ["blue-yellow", "red-green", "luma"];
const GRIDS = [3, 4, 5];
const BITS = [66.7, 100, 133.3, 200];
export function packConfig({ axis, grid, bitMs }) {
  return AXIS_IDS.indexOf(axis) | (GRIDS.indexOf(grid) << 2) | (BITS.indexOf(bitMs) << 4);
}
export function unpackConfig(b) {
  const axis = AXIS_IDS[b & 3];
  const grid = GRIDS[(b >> 2) & 3];
  const bitMs = BITS[(b >> 4) & 3];
  return axis && grid && bitMs ? { axis, grid, bitMs } : null;
}
export const OPTIONS = { AXIS_IDS, GRIDS, BITS };
