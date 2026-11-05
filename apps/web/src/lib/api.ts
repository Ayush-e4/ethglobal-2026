import type { Card } from "@app/shared";

/** Shapes the API returns (apps/api). USDC amounts in base units travel as strings. */
export interface Me {
  id: string;
  isDemo: boolean; // "Try the demo": spends from the shared demo wallet, with daily caps
  displayName: string | null;
  roles: ("user" | "admin")[];
}

export interface ChatSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  cards: Card[];
  createdAt: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Same-origin call to the API (Next forwards /api/* to it, so the cookie stays first-party). */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok)
    throw new ApiError(res.status, data.message ?? data.error ?? `request failed (${res.status})`);
  return data as T;
}

/** 20000 → "0.02". */
export const usdc = (units: string | bigint) => (Number(units) / 1e6).toFixed(2);
export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
