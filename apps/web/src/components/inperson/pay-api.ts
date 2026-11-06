import type { Card } from "@app/shared";

/** What the server says about a scanned or heard request, before anything is paid. */
export type Seen = {
  merchant: { name: string; account: string; verified: boolean };
  inr: number;
  status: "open" | "paying" | "paid" | "expired";
  live: { ok: boolean; reason?: string } | null;
};
export type LimitData = Extract<Card, { type: "limit" }>;

/** POST to our API; the body comes back either way (errors carry a message and a code). */
export async function post<T>(path: string, body: unknown) {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    ok: res.ok,
    data: (await res.json().catch(() => ({}))) as T & { message?: string; error?: string },
  };
}
