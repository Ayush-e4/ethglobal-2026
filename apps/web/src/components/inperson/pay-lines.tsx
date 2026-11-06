/** Small lines on the Pay screen: whether the request was checked live, and the listener. */

export function LiveLine(p: { live: string | null; plain: boolean; heard: boolean }) {
  const { live, plain } = p;
  if (p.heard)
    return (
      <p className="text-sm font-semibold text-saffron-ink">
        Heard nearby: check this name matches the shop&apos;s screen before paying.
      </p>
    );
  if (live) return <p className="text-sm font-semibold text-ok">✓ Live screen confirmed</p>;
  if (plain)
    return (
      <p className="text-sm text-bad">No live layer: this could be a sticker or a screenshot.</p>
    );
  return (
    <p className="text-sm text-ink-2">
      Checking it&apos;s a live screen… keep the camera on the QR
    </p>
  );
}

export function Listening({ heard }: { heard: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-white p-8 text-center">
      <span
        aria-hidden
        className="size-16 animate-pulse rounded-full bg-teal-soft ring-8 ring-teal-soft/50"
      />
      <span className="text-[15px] font-semibold">
        {heard
          ? "Heard it. Making sure only one shop is chirping…"
          : "Listening for the shop's chirp…"}
      </span>
      <span className="text-xs text-muted">Hold your phone 20–50 cm from their device, still.</span>
    </div>
  );
}
