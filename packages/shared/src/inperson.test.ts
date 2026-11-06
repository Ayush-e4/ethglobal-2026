import { describe, expect, it } from "vitest";
import {
  checkLive,
  counterAt,
  crc16,
  decodeRequest,
  encodeRequest,
  fromHex,
  liveCode,
  toHex,
  verifyTag,
} from "./inperson";

const key = new TextEncoder().encode("a-merchant-key-of-32-bytes-long!");
const req = { payee: 11341027, amount: 40, nonce: 123456789, expiresAt: 1_800_000_000 };

describe("paying in person: the request and the live code", () => {
  it("the CRC is CCITT-FALSE, and a request reads back, tagged by its merchant", async () => {
    expect(crc16(new TextEncoder().encode("123456789"))).toBe(0x29b1);
    const bytes = await encodeRequest(req, key);
    expect(bytes.length).toBe(24);
    expect(decodeRequest(fromHex(toHex(bytes)))).toMatchObject({ ok: true, ...req });
    expect(await verifyTag(bytes, key)).toBe(true);
    expect(await verifyTag(bytes, new Uint8Array(32))).toBe(false); // another merchant's key
    const flipped = bytes.slice();
    flipped[6] = (flipped[6] ?? 0) ^ 1; // a changed amount fails the CRC
    expect(decodeRequest(flipped)).toEqual({ ok: false, reason: "crc" });
  });

  it("a live code is good for a few seconds; a screenshot's old code isn't", async () => {
    const bytes = await encodeRequest(req, key);
    const now = counterAt();
    expect(await checkLive(key, bytes, await liveCode(key, bytes, now), now + 2)).toMatchObject({
      ok: true,
    });
    expect(await checkLive(key, bytes, await liveCode(key, bytes, now - 40), now)).toMatchObject({
      ok: false,
    });
    expect(
      await checkLive(new Uint8Array(32), bytes, await liveCode(key, bytes, now), now),
    ).toMatchObject({
      ok: false,
      reason: "not this merchant's screen",
    });
  });
});
