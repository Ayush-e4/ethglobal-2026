/**
 * Browser audio for chirps: the microphone without its "voice" processing, playback, and a
 * signal meter.
 *
 * Phones and browsers clean up the mic for calls: echo cancellation, noise suppression and
 * automatic gain. All three treat steady tones as noise and erase them, which is exactly what
 * a chirp is made of, so they're switched off. Mic access needs a secure page (https or
 * localhost), and on iPhones audio only starts from a tap.
 */
import { GG } from "./modem.js";

export async function openAudio() {
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  const ctx = new Ctx({ latencyHint: "interactive" });
  if (ctx.state !== "running") await ctx.resume();
  return ctx;
}

export async function openMic(ctx) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("this page needs https (or localhost) for the microphone");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });
  const source = ctx.createMediaStreamSource(stream);
  return {
    source,
    stop() {
      source.disconnect();
      for (const t of stream.getTracks()) t.stop();
    },
  };
}

/**
 * Calls onSamples(Float32Array) with every block the mic records. ScriptProcessorNode is old but
 * works everywhere ggwave's own demos run; a silent gain keeps it pulling audio in Chrome.
 */
export function tap(ctx, source, onSamples, blockSize = 4096) {
  const node = ctx.createScriptProcessor(blockSize, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.onaudioprocess = (e) => onSamples(new Float32Array(e.inputBuffer.getChannelData(0)));
  source.connect(node);
  node.connect(mute);
  mute.connect(ctx.destination);
  return () => {
    node.onaudioprocess = null;
    source.disconnect(node);
    node.disconnect();
    mute.disconnect();
  };
}

/** Plays samples; resolves when they've finished. stop() cuts it short. */
export function play(ctx, samples, sampleRate = ctx.sampleRate) {
  const buf = ctx.createBuffer(1, samples.length, sampleRate);
  buf.copyToChannel(samples, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  const done = new Promise((resolve) => {
    src.onended = resolve;
  });
  src.start();
  return { done, stop: () => src.stop() };
}

/**
 * How strong the chirp band is: mean power inside ggwave's audible band (1875–6375 Hz) against
 * the bands just outside it (700–1700 and 7000–9000 Hz), in dB. Above ~10 dB a chirp is
 * there and loud enough; near 0 it's either silent or drowned. Also the overall level in dBFS.
 */
export function meter(ctx, source) {
  const an = ctx.createAnalyser();
  an.fftSize = 4096;
  an.smoothingTimeConstant = 0.6;
  source.connect(an);
  const bins = new Float32Array(an.frequencyBinCount);
  const hz = ctx.sampleRate / an.fftSize;
  const power = (lo, hi) => {
    let s = 0;
    let n = 0;
    for (let i = Math.floor(lo / hz); i <= Math.ceil(hi / hz) && i < bins.length; i++) {
      s += 10 ** (bins[i] / 10);
      n++;
    }
    return s / Math.max(1, n);
  };
  const time = new Float32Array(an.fftSize);
  return {
    /** n levels (0..1) across the chirp band, for a visual meter: what the mic hears right now. */
    bands(n) {
      an.getFloatFrequencyData(bins);
      const [lo, hi] = GG.audibleBand;
      const out = new Array(n);
      for (let k = 0; k < n; k++) {
        const db =
          10 * Math.log10(power(lo + ((hi - lo) * k) / n, lo + ((hi - lo) * (k + 1)) / n) + 1e-20);
        out[k] = Math.max(0, Math.min(1, (db + 95) / 55)); // −95 dB (silence) → 0, −40 dB (loud) → 1
      }
      return out;
    },
    read() {
      an.getFloatFrequencyData(bins);
      an.getFloatTimeDomainData(time);
      let sq = 0;
      for (const v of time) sq += v * v;
      const level = 10 * Math.log10(sq / time.length + 1e-12);
      const band = power(GG.audibleBand[0], GG.audibleBand[1]);
      const ref = (power(700, 1700) + power(7000, 9000)) / 2;
      return { level, bandDb: 10 * Math.log10(band / (ref + 1e-20)) };
    },
    stop() {
      source.disconnect(an);
    },
  };
}

/** Waits until the chirp band has been quiet for `quietMs` (or `maxMs` passes): talk after listening. */
export async function waitForQuiet(m, { quietMs = 300, maxMs = 4000, thresholdDb = 6 } = {}) {
  const start = performance.now();
  let quietSince = performance.now();
  while (performance.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 50));
    if (m.read().bandDb > thresholdDb) quietSince = performance.now();
    else if (performance.now() - quietSince >= quietMs) return true;
  }
  return false;
}
