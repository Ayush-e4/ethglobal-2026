/**
 * The back camera to scan with. Phones with several back lenses may hand out a fixed-focus one
 * first (an ultra-wide): a Galaxy S21 FE gave "camera2 2", manual focus only, so a QR 20–40 cm
 * away stayed blurred and never scanned. If the camera can't focus by itself, the other back
 * cameras are tried and the first that can is kept, set to focus continuously.
 */
const VIDEO = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };

type Caps = { focusMode?: string[] };
const focuses = (s: MediaStream) => {
  const t = s.getVideoTracks()[0];
  const modes = (t?.getCapabilities?.() as Caps | undefined)?.focusMode;
  return !modes || modes.includes("continuous"); // unknown (older Safari): trust the default
};
const stop = (s: MediaStream) => {
  for (const t of s.getTracks()) t.stop();
};
const open = (video: MediaTrackConstraints) =>
  navigator.mediaDevices.getUserMedia({ video: { ...VIDEO, ...video }, audio: false });

export async function backCamera(): Promise<MediaStream> {
  const first = await open({ facingMode: { ideal: "environment" } });
  let chosen = first;
  if (!focuses(first)) {
    const firstId = first.getVideoTracks()[0]?.getSettings().deviceId;
    const backs = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) =>
        d.kind === "videoinput" && d.deviceId !== firstId && /back|rear|environment/i.test(d.label),
    );
    stop(first); // a phone opens one camera at a time
    chosen = await (async () => {
      for (const d of backs) {
        const s = await open({ deviceId: { exact: d.deviceId } }).catch(() => null);
        if (s && focuses(s)) return s;
        if (s) stop(s);
      }
      return open(
        firstId ? { deviceId: { exact: firstId } } : { facingMode: { ideal: "environment" } },
      );
    })();
  }
  const track = chosen.getVideoTracks()[0];
  await track
    ?.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] })
    .catch(() => {});
  return chosen;
}
