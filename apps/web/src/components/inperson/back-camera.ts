/**
 * The back camera to scan with: the phone's default "environment" camera, as always (never a
 * switch to another lens: on a phone whose main camera is broken, merely trying it jammed the
 * camera until Chrome restarted). Then, within a time limit so the scanner never waits on it:
 * a camera that can focus by itself is asked to keep focusing, and a fixed-focus one (a wide
 * lens, as a Galaxy S21 FE's "camera2 2") is zoomed 2× so the QR fills more of the picture.
 */
const VIDEO = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };

type Caps = { focusMode?: string[]; zoom?: { min: number; max: number } };

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms)),
  ]);
}

export async function backCamera(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, ...VIDEO },
    audio: false,
  });
  const track = stream.getVideoTracks()[0];
  const c = (track?.getCapabilities?.() ?? {}) as Caps;
  const set = (x: Record<string, unknown>) =>
    track
      ? within(track.applyConstraints({ advanced: [x as MediaTrackConstraintSet] }), 1500).catch(
          () => {},
        )
      : Promise.resolve();
  if (c.focusMode?.includes("continuous")) await set({ focusMode: "continuous" });
  else if (c.focusMode && c.zoom && c.zoom.max >= 2) await set({ zoom: 2 });
  return stream;
}
