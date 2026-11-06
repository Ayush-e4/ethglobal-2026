/**
 * A thin, safe wrapper over ggwave, the same in the browser and in Node.
 *
 * ggwave's JS binding returns views into its WebAssembly memory that the next call overwrites
 * (and that break if the memory grows), so everything is copied out at once. It also allows only
 * 4 instances in total: a modem holds two (send, receive) and frees them in close().
 */
import { FRAME_BYTES } from "@app/shared";

export const PROTOCOLS = Object.freeze({
  "audible-normal": "GGWAVE_PROTOCOL_AUDIBLE_NORMAL",
  "audible-fast": "GGWAVE_PROTOCOL_AUDIBLE_FAST",
  "audible-fastest": "GGWAVE_PROTOCOL_AUDIBLE_FASTEST",
  "ultrasound-normal": "GGWAVE_PROTOCOL_ULTRASOUND_NORMAL",
  "ultrasound-fast": "GGWAVE_PROTOCOL_ULTRASOUND_FAST",
  "ultrasound-fastest": "GGWAVE_PROTOCOL_ULTRASOUND_FASTEST",
});

/** ggwave's own numbers: 1024-sample FFT frames at 48 kHz, so 46.875 Hz between tones. */
export const GG = Object.freeze({
  sampleRate: 48000,
  samplesPerFrame: 1024,
  hzPerBin: 48000 / 1024,
  audibleBand: [40 * (48000 / 1024), (40 + 96) * (48000 / 1024)], // 1875–6375 Hz
  ultrasoundBand: [320 * (48000 / 1024), (320 + 96) * (48000 / 1024)], // 15000–19500 Hz
});

/**
 * @param gg       the ggwave module (from ggwave_factory())
 * @param options  sampleRate: the audio device's real rate (ggwave resamples to 48 kHz itself);
 *                 protocol: a key of PROTOCOLS; fixed: fixed-length frames (no markers, faster);
 *                 dss: ggwave's direct-sequence spreading; volume: 1–100;
 *                 listenFor: protocols the receiver tries (default: the one we send with)
 */
export function createModem(gg, options = {}) {
  const {
    sampleRate = GG.sampleRate,
    protocol = "audible-fast",
    fixed = true,
    dss = false,
    volume = 25,
    listenFor = [protocol],
  } = options;
  if (!(protocol in PROTOCOLS)) throw new Error(`unknown protocol ${protocol}`);

  const params = gg.getDefaultParameters();
  params.sampleRateInp = sampleRate;
  params.sampleRateOut = sampleRate;
  params.payloadLength = fixed ? FRAME_BYTES : -1;
  if (dss) params.operatingMode |= gg.GGWAVE_OPERATING_MODE_USE_DSS;

  const live = new Set();
  const make = () => {
    // ggwave's rx protocol table is global and read when an instance is made, so set it right
    // before every init: another modem may have changed it since.
    for (const [name, id] of Object.entries(PROTOCOLS)) {
      gg.rxToggleProtocol(gg.ProtocolId[id], listenFor.includes(name) ? 1 : 0);
    }
    const id = gg.init(params);
    if (id < 0) throw new Error("ggwave: no free instance (at most 4)");
    live.add(id);
    return id;
  };
  let tx = -1; // made on first use, so a listen-only modem holds one instance, not two

  return {
    sampleRate,
    protocol,
    fixed,

    /** Bytes → mono Float32 samples at `sampleRate`, ready to play. */
    encode(bytes, txProtocol = protocol) {
      if (tx < 0) tx = make();
      const view = gg.encode(tx, bytes, gg.ProtocolId[PROTOCOLS[txProtocol]], volume);
      return new Float32Array(new Int8Array(view).buffer); // copy, then read the bytes as floats
    },

    /** Seconds on air for one frame. */
    airtime(txProtocol = protocol) {
      return this.encode(new Uint8Array(FRAME_BYTES), txProtocol).length / sampleRate;
    },

    /**
     * A listener: push microphone samples in any chunk size; get back every payload ggwave
     * decodes (raw bytes, not yet checked: run them through decodeFrame).
     *
     * In fixed-length mode ggwave keeps re-scanning its recent history, so one transmission is
     * often decoded 2–5 times in a row. The same bytes again within `dedupeSec` of audio are
     * dropped here, so each transmission comes out once.
     */
    receiver({ dedupeSec = 2 } = {}) {
      const rx = make();
      const chunk = new Float32Array(GG.samplesPerFrame);
      const dedupeFrames = Math.ceil((dedupeSec * sampleRate) / GG.samplesPerFrame);
      let fill = 0;
      let frameNo = 0;
      let last = null;
      let lastAt = -Infinity;
      const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
      return {
        push(samples) {
          const out = [];
          for (let i = 0; i < samples.length; ) {
            const n = Math.min(chunk.length - fill, samples.length - i);
            chunk.set(samples.subarray(i, i + n), fill);
            fill += n;
            i += n;
            if (fill === chunk.length) {
              fill = 0;
              frameNo++;
              const res = gg.decode(rx, new Int8Array(chunk.buffer.slice(0)));
              if (res && res.length > 0) {
                const bytes = new Uint8Array(res); // copy out of wasm memory
                if (!(last && same(bytes, last) && frameNo - lastAt <= dedupeFrames))
                  out.push(bytes);
                last = bytes;
                lastAt = frameNo;
              }
            }
          }
          return out;
        },
        close() {
          if (live.delete(rx)) gg.free(rx);
        },
      };
    },

    close() {
      for (const id of live) gg.free(id);
      live.clear();
    },
  };
}
