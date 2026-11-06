/**
 * A small in-memory limit per key (e.g. per network address): at most `max` in any `windowMs`.
 * One API process, so memory is enough; a restart forgets, which errs on the side of letting
 * people in.
 */
export function rateLimit(max: number, windowMs: number, now = () => Date.now()) {
  const seen = new Map<string, number[]>();
  return (key: string) => {
    const t = now();
    const recent = (seen.get(key) ?? []).filter((x) => t - x < windowMs);
    if (recent.length >= max) {
      seen.set(key, recent);
      return false;
    }
    recent.push(t);
    seen.set(key, recent);
    if (seen.size > 10_000) seen.clear(); // never grows without bound
    return true;
  };
}

/** The visitor's address as our proxies pass it on (the first in X-Forwarded-For). */
export const clientIp = (h: (name: string) => string | undefined) =>
  h("x-forwarded-for")?.split(",")[0]?.trim() || h("x-real-ip") || null;
