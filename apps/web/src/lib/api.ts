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

/** A hire as GET /chats/:id/hires shows it: the hire card's live status. */
export interface HireView {
  id: string;
  title: string;
  agentName: string;
  feeUnits: string;
  status: "paying" | "held" | "cancelled" | "delivered" | "released" | "refunded" | "failed";
  payTx: string | null; // the Hedera transaction that holds the fee
  undoUntil: string | null;
  bookingRef: string | null;
  note: string | null;
  watching: boolean; // a watching agent still at work after it's paid
  watchNote: string | null; // e.g. "Saved ₹800 · 1 rebook · watching the price until 20 Dec"
  canSimulateDrop?: boolean; // demo only
}

/** GET /wallet: a passkey account's Face ID wallet. Demo accounts have none. */
export interface WalletInfo {
  demo: boolean;
  wallet: null | {
    address: string; // EVM address
    hederaId: string | null; // 0.0.x
    status: "creating" | "ready" | "failed";
    usdcUnits: string | null;
    giftUnits: string | null; // the test USDC it started with, if any
  };
}

/** A "prove you're a person" check: approved in the World ID app, judged by our server. */
export interface WorldCheck {
  id: string;
  status: "waiting" | "verified" | "denied" | "expired" | "failed" | "mismatch";
  reason?: string;
  userCode: string;
  link: string; // World's page for this check (it opens the World ID app)
  expiresAt: string;
}

/** GET /world: World ID on this account, and its welcome bonus. */
export interface WorldInfo {
  available: boolean; // false: World ID isn't set up on this server
  verified?: boolean;
  bonusUnits?: string;
  bonus?: { units: string; status: "sending" | "sent" | "failed"; tx: string | null } | null;
  check?: WorldCheck | null; // the newest bonus check
}

/** GET /wallet/limits: what the concierge may spend from your wallet, and where. */
export interface WalletLimit {
  id: string;
  chatId: string;
  chatTitle: string;
  agentName: string | null;
  mandateId: string;
  budgetUnits: string;
  remainingUnits: string | null;
  expiresAt: string;
  status: "active" | "expired" | "cancelled";
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
/** HashScan opens a transaction by its Hedera id (0.0.x@seconds.nanos). */
export const hashscanTx = (tx: string) => `https://hashscan.io/testnet/transaction/${tx}`;
export const hashscanAccount = (id: string) => `https://hashscan.io/testnet/account/${id}`;
