import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { decodeRequest, encodeRequest } from "@app/shared";
import { describe, expect, it } from "vitest";
import { createModem } from "@/lib/inperson/modem";

// The same ggwave the app serves (public/vendor/ggwave.js), loaded in Node.
const require = createRequire(import.meta.url);
const factory = require(
  fileURLToPath(new URL("../../../public/vendor/ggwave.js", import.meta.url)),
);

describe("Chirp to Pay, speaker to mic", () => {
  it("a request played in both speeds is heard back exactly, and reads as the same request", async () => {
    const gg = await factory({ print() {}, printErr() {} });
    gg.disableLog();
    const req = await encodeRequest(
      { payee: 4242, amount: 40, nonce: 7, expiresAt: Math.floor(Date.now() / 1000) + 120 },
      new TextEncoder().encode("a-merchant-key-of-32-bytes-long!"),
    );
    for (const p of ["audible-fastest", "audible-normal"]) {
      const tx = createModem(gg, { sampleRate: 48000, fixed: true, listenFor: [] });
      const rx = createModem(gg, { sampleRate: 48000, fixed: true, listenFor: [p] });
      const ear = rx.receiver();
      const sound = tx.encode(req, p);
      const heard = [...ear.push(sound), ...ear.push(new Float32Array(48000))]; // a second of quiet after
      ear.close();
      tx.close();
      rx.close();
      expect(heard.length).toBeGreaterThan(0);
      expect(decodeRequest(heard[0] as Uint8Array)).toMatchObject({
        ok: true,
        payee: 4242,
        amount: 40,
      });
    }
  });
});
