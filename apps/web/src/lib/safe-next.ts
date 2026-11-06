/**
 * Where to go after signing in: only a path on this site. `new URL` resolves the tricks a prefix
 * check misses ("/\\evil.example", "//evil.example", encoded slashes) to another origin.
 */
export function safeNext(next: string | null | undefined, origin: string, fallback = "/chat") {
  if (!next?.startsWith("/")) return fallback;
  try {
    const url = new URL(next, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
