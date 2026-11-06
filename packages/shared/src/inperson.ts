/**
 * Paying in person, the bytes: a merchant's 24-byte payment request (shown as a Live QR or
 * chirped as sound) and the live code that proves a QR is on the merchant's screen right now.
 * From the Chirp to Pay and Live QR labs; the same format both ways.
 *
 * Request, big-endian:
 *   [0] version << 4 | kind, [1..4] payee (Hedera account number: 0.0.<n>),
 *   [5..8] amount in base units, [9] token, [10..13] nonce, [14..17] expiresAt (unix seconds),
 *   [18..21] tag: HMAC-SHA256(merchant key, bytes 0..17), first 4 bytes, [22..23] CRC-16.
 * The tag is for the server that settles (only it holds the key); the CRC throws away noise.
 */
export const FRAME_BYTES = 24;
const VERSION = 1;
const KIND_REQUEST = 1;
const TOKEN_USDC = 1;
const U32_MAX = 0xffffffff;

/** CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF. "123456789" → 0x29B1. */
export function crc16(bytes: Uint8Array, end = bytes.length) {
  let crc = 0xffff;
  for (let i = 0; i < end; i++) {
    crc ^= (bytes[i] ?? 0) << 8;
    for (let b = 0; b < 8; b++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

const u32 = (name: string, v: number) => {
  if (!Number.isInteger(v) || v < 0 || v > U32_MAX)
    throw new RangeError(`${name} must fit in 32 bits`);
  return v;
};

async function hmac4(key: Uint8Array, bytes: Uint8Array) {
  const k = await globalThis.crypto.subtle.importKey(
    "raw",
    new Uint8Array(key), // a copy on its own ArrayBuffer, as Web Crypto wants
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await globalThis.crypto.subtle.sign("HMAC", k, new Uint8Array(bytes)),
  ).subarray(0, 4);
}

const same4 = (a: Uint8Array, b: Uint8Array) => {
  let diff = 0;
  for (let i = 0; i < 4; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0; // constant time
};

export const newNonce = () =>
  new DataView(globalThis.crypto.getRandomValues(new Uint8Array(4)).buffer).getUint32(0);

export interface PayRequest {
  payee: number; // 0.0.<payee>
  amount: number; // base units
  nonce: number;
  expiresAt: number; // unix seconds
}

/** A merchant's request, tagged with its key. */
export async function encodeRequest(r: PayRequest, key: Uint8Array) {
  const buf = new Uint8Array(FRAME_BYTES);
  const v = new DataView(buf.buffer);
  v.setUint8(0, (VERSION << 4) | KIND_REQUEST);
  v.setUint32(1, u32("payee", r.payee));
  v.setUint32(5, u32("amount", r.amount));
  v.setUint8(9, TOKEN_USDC);
  v.setUint32(10, u32("nonce", r.nonce));
  v.setUint32(14, u32("expiresAt", r.expiresAt));
  buf.set(await hmac4(key, buf.subarray(0, 18)), 18);
  v.setUint16(22, crc16(buf, 22));
  return buf;
}

export type Decoded =
  | (PayRequest & { ok: true; tag: Uint8Array; bytes: Uint8Array })
  | { ok: false; reason: string };

/** Reads a request. Never throws: bad input is `{ ok: false, reason }`. */
export function decodeRequest(bytes: Uint8Array): Decoded {
  if (bytes.length !== FRAME_BYTES) return { ok: false, reason: "length" };
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint16(22) !== crc16(bytes, 22)) return { ok: false, reason: "crc" };
  if ((bytes[0] ?? 0) >> 4 !== VERSION || ((bytes[0] ?? 0) & 0x0f) !== KIND_REQUEST)
    return { ok: false, reason: "kind" };
  if (v.getUint8(9) !== TOKEN_USDC) return { ok: false, reason: "token" };
  return {
    ok: true,
    payee: v.getUint32(1),
    amount: v.getUint32(5),
    nonce: v.getUint32(10),
    expiresAt: v.getUint32(14),
    tag: bytes.slice(18, 22),
    bytes: bytes.slice(),
  };
}

/** Server side: did the merchant with this key make this request? */
export async function verifyTag(bytes: Uint8Array, key: Uint8Array) {
  return same4(await hmac4(key, bytes.subarray(0, 18)), bytes.subarray(18, 22));
}

// The live code: changes every 250 ms, made with the request's live key. A sticker or a
// screenshot shows an old code (or none); only the live screen shows now's.
export const STEP_MS = 250;
const MAX_AGE_STEPS = 12; // 3 s: the camera's delay plus clocks that disagree a little
export const counterAt = (ms = Date.now()) => Math.floor(ms / STEP_MS) >>> 0;

async function liveTag(key: Uint8Array, request: Uint8Array, counter: number) {
  const msg = new Uint8Array(request.length + 4);
  msg.set(request);
  new DataView(msg.buffer).setUint32(request.length, counter);
  return hmac4(key, msg);
}

/** The 8-byte live code for a request at a moment: the 250 ms counter, then its tag. */
export async function liveCode(key: Uint8Array, request: Uint8Array, counter = counterAt()) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setUint32(0, counter);
  out.set(await liveTag(key, request, counter), 4);
  return out;
}

/** Is this live code genuine, and from the last few seconds? */
export async function checkLive(
  key: Uint8Array,
  request: Uint8Array,
  code: Uint8Array,
  now = counterAt(),
) {
  if (code.length !== 8) return { ok: false as const, reason: "no live code" };
  const counter = new DataView(code.buffer, code.byteOffset, 8).getUint32(0);
  const age = now - counter;
  if (age < -MAX_AGE_STEPS || age > MAX_AGE_STEPS)
    return { ok: false as const, reason: "an old code: a photo or a screenshot" };
  return same4(await liveTag(key, request, counter), code.subarray(4))
    ? { ok: true as const, ageMs: age * STEP_MS }
    : { ok: false as const, reason: "not this merchant's screen" };
}

export const toHex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (h: string) =>
  /^([0-9a-f]{2})*$/i.test(h)
    ? Uint8Array.from(h.match(/../g) ?? [], (x) => Number.parseInt(x, 16))
    : new Uint8Array();
