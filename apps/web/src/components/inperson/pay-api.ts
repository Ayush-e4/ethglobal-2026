import type { Card } from "@app/shared";
import { noAnswer, saying } from "@/lib/errors";

/** What the server says about a scanned or heard request, before anything is paid. */
export type Seen = {
  merchant: { name: string; account: string; verified: boolean };
  inr: number;
  status: "open" | "paying" | "paid" | "expired";
  live: { ok: boolean; reason?: string } | null;
};
export type LimitData = Extract<Card, { type: "limit" }>;

/**
 * POST to our API; the body comes back either way (errors carry a code, and `message` in words).
 * No answer at all (offline, the connection dropped) is `status` 0, never a thrown error, so a
 * screen can't be left waiting on "Paying…".
 */
export async function post<T>(path: string, body: unknown) {
  type Body = T & { message?: string; error?: string };
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) {
    const gone = noAnswer();
    return { ok: false, status: 0, data: { error: gone.code, message: gone.message } as Body };
  }
  const data = (await res.json().catch(() => ({}))) as Body;
  if (!res.ok) data.message = saying(res.status, data);
  return { ok: res.ok, status: res.status, data };
}
