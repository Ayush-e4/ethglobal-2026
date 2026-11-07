/**
 * What went wrong, said the way a person would say it. The API answers with a sentence when it
 * has one (`message`) and often only a code (`error: "not_found"`); a proxy or a dropped
 * connection answers with nothing at all. Everything a screen shows comes through here, so no
 * one ever reads "signed_out", "request failed (502)" or "Failed to fetch".
 */
export class ApiError extends Error {
  constructor(
    readonly status: number, // 0: the request never got an answer (offline, no connection)
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export const OFFLINE = "You're offline. This works again once you're connected.";
export const UNREACHABLE = "Couldn't reach Shikigami. Check your connection, then try again.";
export const OUR_SIDE = "Something went wrong on our side. Try again in a moment.";
export const SIGNED_OUT = "You've been signed out. Sign in again to carry on.";
const BUSY = "That's a lot at once. Wait a few seconds, then try again.";

/** The API's bare codes, in words. */
const CODES: Record<string, string> = {
  signed_out: SIGNED_OUT,
  not_found: "That isn't here any more. It may have been removed.",
  "not found": "That isn't here any more. It may have been removed.",
  bad_request: "Something in that didn't look right. Check it, then try again.",
  internal: OUR_SIDE,
  failed: OUR_SIDE,
  too_many: BUSY,
  rate_limited: BUSY,
  too_soon: BUSY,
  demo: "Demo accounts can't do that. Sign in with a passkey to use it.",
  no_wallet: "Your Face ID wallet isn't ready yet. Give it a few seconds.",
  expired: "This has expired. Start it again.",
  expired_token: "This has expired. Start it again.",
  link_gone: "This link has expired or was already used.",
  access_denied: "That was turned down.",
  method_not_allowed: OUR_SIDE,
};

/** By the HTTP status, when there are no words at all. */
const byStatus = (status: number) =>
  status === 401
    ? SIGNED_OUT
    : status === 403
      ? "That isn't yours to change."
      : status === 404 || status === 410
        ? CODES.not_found
        : status === 409
          ? "That can't be done right now. It may have changed: refresh, then try again."
          : status === 429
            ? BUSY
            : status >= 500
              ? OUR_SIDE
              : "That didn't work. Try again.";

/** A code ("not_found", "HTTP 503"), not words a person could read. */
const isCode = (s: string) => /^[a-z0-9_ ]+$/.test(s) && !/ .+ /.test(s);

/** "the agent didn't take it" → "The agent didn't take it." Setup details stay out of it. */
export function sentence(s: string) {
  const t = s
    .replace(/\s*\([^)]*[A-Z_]{4,}[^)]*\)/g, "") // "(no RESEND_API_KEY)"
    .replace(/\s+on this server\b/i, " here")
    .trim();
  if (!t) return t;
  const first = t[0].toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(first) ? first : `${first}.`;
}

/** The words for an API answer that wasn't ok. */
export function saying(status: number, body: { error?: unknown; message?: unknown }) {
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const code = typeof body.error === "string" ? body.error.trim() : "";
  if (status === 401 && code === "signed_out") return SIGNED_OUT;
  if (message && !isCode(message) && !/^HTTP \d{3}$/.test(message)) return sentence(message);
  if (code && CODES[code]) return CODES[code];
  if (code && !isCode(code) && !/^HTTP \d{3}$/.test(code)) return sentence(code);
  return byStatus(status);
}

/** No answer at all: offline, or the connection dropped. */
export const noAnswer = () =>
  new ApiError(
    0,
    typeof navigator !== "undefined" && navigator.onLine === false ? OFFLINE : UNREACHABLE,
    "no_answer",
  );

/** Anything caught, in words: our errors as they are, anything else as `fallback`. */
export function friendly(err: unknown, fallback = "That didn't work. Try again.") {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message))
    return noAnswer().message;
  return fallback;
}

/** Signed out mid-use (the cookie expired): the app shell sends you to sign in, and back. */
export const SIGNED_OUT_EVENT = "shikigami:signed-out";
