export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Sends an email; false when email is off or it didn't go. */
export type SendEmail = (e: Email) => Promise<boolean>;

/**
 * Email through Resend (resend.com). Off without a key. Until a domain is verified there, Resend
 * only delivers from its test address (onboarding@resend.dev) to the Resend account's own email.
 */
export function resendEmail(
  key: string | undefined,
  from = "AgentNet <onboarding@resend.dev>",
  fetchImpl: typeof fetch = fetch,
  log: (line: string) => void = (line) => console.error(line),
): SendEmail {
  return async (e) => {
    if (!key) return false;
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [e.to], subject: e.subject, html: e.html, text: e.text }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (res?.ok) return true;
    // Resend's message says why (e.g. "You can only send testing emails to your own address").
    const why = res
      ? ((await res.json().catch(() => ({}))) as { message?: string }).message
      : "unreachable";
    log(
      `email: to ${e.to.replace(/^(.).*@/, "$1…@")} not sent: ${String(why ?? res?.status).slice(0, 160)}`,
    );
    return false;
  };
}
