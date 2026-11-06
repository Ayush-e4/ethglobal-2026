import { openAudio, openMic, play, tap } from "@/lib/inperson/audio";
import { createModem } from "@/lib/inperson/modem";

/**
 * Chirp to Pay: a payment request as sound (ggwave, MIT: tones with error correction, loaded
 * from /vendor/ggwave.js, WebAssembly inside). The shop's device plays the request again and
 * again in two speeds: fast (0.7 s) and echo-proof (2.1 s); the payer's phone listens for both.
 * From the Chirp to Pay lab, tuned in ~2,900 simulated rooms: hold the phone 20–50 cm away, still.
 */
type GG = { disableLog(): void };
let gg: Promise<GG> | null = null;

function ggwave() {
  gg ??= new Promise<GG>((resolve, reject) => {
    const w = window as unknown as { ggwave_factory?: (o: object) => Promise<GG> };
    const ready = () =>
      w.ggwave_factory?.({ print() {}, printErr() {} }).then((m) => {
        m.disableLog();
        resolve(m);
      }, reject);
    if (w.ggwave_factory) return void ready();
    const s = document.createElement("script");
    s.src = "/vendor/ggwave.js";
    s.onload = () => void ready();
    s.onerror = () => reject(new Error("The sound engine didn't load."));
    document.head.append(s);
  });
  return gg;
}

/** Starts loading the engine early (the screens call it when they open). */
export const preloadSound = () => void ggwave().catch(() => {});

const SEND = ["audible-fastest", "audible-normal"];
const GAP_MS = 800;

/** Plays the request over and over until stop(). Start it from a tap (iPhones insist). */
export async function chirp(frame: Uint8Array) {
  const ctx = await openAudio(); // first, inside the tap: iPhones only start audio from one
  const g = await ggwave();
  const modem = createModem(g, {
    sampleRate: ctx.sampleRate,
    fixed: true,
    volume: 40,
    listenFor: [],
  });
  const waves = SEND.map((p) => modem.encode(frame, p));
  let stopped = false;
  let current: { stop: () => void } | null = null;
  void (async () => {
    while (!stopped)
      for (const w of waves) {
        if (stopped) break;
        const playing = play(ctx, w);
        current = playing;
        await playing.done;
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
  })();
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        current?.stop();
      } catch {}
      modem.close();
      void ctx.close();
    },
  };
}

/** Listens for a request: every 24 bytes heard (ggwave's error correction already applied). */
export async function listen(onFrame: (bytes: Uint8Array) => void) {
  const ctx = await openAudio(); // first, inside the tap
  const g = await ggwave();
  const mic = await openMic(ctx); // calls' echo and noise cancelling off: they erase tones
  const modems = SEND.map((p) =>
    createModem(g, { sampleRate: ctx.sampleRate, fixed: true, listenFor: [p] }),
  );
  const rxs = modems.map((m) => m.receiver());
  const untap = tap(ctx, mic.source, (s: Float32Array) => {
    for (const rx of rxs) for (const b of rx.push(s)) onFrame(b);
  });
  return {
    stop() {
      untap();
      mic.stop();
      for (const rx of rxs) rx.close();
      for (const m of modems) m.close();
      void ctx.close();
    },
  };
}
