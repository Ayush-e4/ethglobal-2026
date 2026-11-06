export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Sends an email; false when email is off or it didn't go. */
export type SendEmail = (e: Email) => Promise<boolean>;
/** Sends an email and says why it didn't go (for "send a test email"). */
export type TryEmail = (e: Email) => Promise<{ ok: true } | { ok: false; error: string }>;

const mask = (to: string) => to.replace(/^(.).*@/, "$1…@");

/**
 * Email through Resend (resend.com). Off without a key. Until a domain is verified there, Resend
 * only delivers from its test address (onboarding@resend.dev) to the Resend account's own email.
 */
export function resendTry(
  key: string | undefined,
  from = "AgentNet <onboarding@resend.dev>",
  fetchImpl: typeof fetch = fetch,
): TryEmail {
  return async (e) => {
    if (!key) return { ok: false, error: "email isn't set up on this server (no RESEND_API_KEY)" };
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [e.to], subject: e.subject, html: e.html, text: e.text }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (res?.ok) return { ok: true };
    // Resend's message says why (e.g. "You can only send testing emails to your own address").
    const why = res
      ? ((await res.json().catch(() => ({}))) as { message?: string }).message
      : "Resend didn't answer";
    return { ok: false, error: String(why ?? `HTTP ${res?.status}`).slice(0, 200) };
  };
}

export function resendEmail(
  key: string | undefined,
  from?: string,
  fetchImpl: typeof fetch = fetch,
  log: (line: string) => void = (line) => console.error(line),
): SendEmail {
  const send = resendTry(key, from, fetchImpl);
  return async (e) => {
    if (!key) return false;
    const r = await send(e);
    if (!r.ok) log(`email: to ${mask(e.to)} not sent: ${r.error}`);
    return r.ok;
  };
}
