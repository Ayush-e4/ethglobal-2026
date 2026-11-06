import { checkLive, encodeRequest, fromHex, toHex } from "@app/shared";
import { describe, expect, it } from "vitest";
import { liveFrames } from "./live-frames";
import { createScanner } from "./scanner";

describe("Live QR, screen to scanner", () => {
  it("the scanner reads the request, then a live code the merchant's key accepts", async () => {
    const merchantKey = new TextEncoder().encode("a-merchant-key-of-32-bytes-long!");
    const liveKey = new TextEncoder().encode("this-request-live-key-32-bytes!!");
    const req = await encodeRequest(
      { payee: 4242, amount: 40, nonce: 99, expiresAt: Math.floor(Date.now() / 1000) + 120 },
      merchantKey,
    );
    const f = liveFrames(toHex(req), toHex(liveKey));
    const seen: string[] = [];
    const codes: string[] = [];
    const scanner = createScanner({ request: (r) => seen.push(r), live: (c) => codes.push(c) });
    // The screen at 60 fps, the camera taking every second picture (30 fps), for up to 6 s.
    const t0 = Date.now();
    for (let t = 0; t < 6000 && codes.length === 0; t += 1000 / 60) {
      if (Math.round(t) % 100 < 17) await f.refresh(t0 + t);
      f.draw(t);
      if (Math.round(t / (1000 / 60)) % 2 === 0)
        scanner.frame({ data: f.rgba, width: f.size, height: f.size } as ImageData, t);
    }
    expect(seen).toEqual([toHex(req)]);
    expect(codes.length).toBeGreaterThan(0);
    const code = fromHex(codes[0] ?? "");
    const now = new DataView(code.buffer).getUint32(0); // judged at the moment it was shown
    expect(await checkLive(liveKey, req, code, now)).toMatchObject({ ok: true });
  });
});
