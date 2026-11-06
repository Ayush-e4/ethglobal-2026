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
  priceUnits: string | null; // the trip price in the same escrow (testnet scale: 1 unit = ₹1)
  card: {
    last4: string;
    brand: string;
    merchant: string;
    amount: number;
    currency: string;
    status: "authorized" | "captured" | "voided";
    expiresAt: string;
  } | null; // the one-time card the agent paid the supplier with (simulated)
  status:
    | "paying"
    | "held"
    | "cancelled"
    | "delivered"
    | "released"
    | "refunded"
    | "failed"
    | "disputed";
  payTx: string | null; // the Hedera transaction that holds the fee
  undoUntil: string | null;
  bookingRef: string | null;
  note: string | null;
  watching: boolean; // a watching agent still at work after it's paid
  watchNote: string | null; // e.g. "Saved ₹800 · 1 rebook · watching the price until 20 Dec"
  canSimulateDrop?: boolean; // demo only
  reviewUntil: string | null; // after delivery: a problem can be reported until then
  canReport: boolean;
  bookingCancelledAt: string | null; // the guest cancelled it afterwards
  canCancelBooking: boolean;
  guestName: string | null;
  chatId: string;
  createdAt: string;
}

/** GET /trips: a booking, with the chat it was made in. */
export type Trip = HireView & { chatTitle: string };

/** GET /receipts/:id: a booking's public proof. */
export interface Receipt {
  title: string;
  agentName: string;
  feeUnits: string;
  status: HireView["status"];
  bookedAt: string;
  guest: string; // initials
  bookingRef: string | null; // only in part
  bookingCancelled: boolean;
  priceUnits: string | null;
  card: Pick<
    NonNullable<HireView["card"]>,
    "last4" | "merchant" | "amount" | "currency" | "status"
  > | null;
  note: string | null;
  escrow: {
    state: string;
    amountUnits: string;
    deliveredAt: string | null;
    reviewSeconds: number;
  } | null;
  links: { label: string; url: string }[];
}

/** The marketplace's review of an agent: shown only when approved. */
export interface AgentReviewView {
  status: "approved" | "failed" | "suspended";
  operator: "agentnet" | "verified-person";
  checks: { id: string; ok: boolean; note: string }[];
  note: string | null;
  checkedAt: string;
  arkiv: string | null;
}

/** GET /market/agents: an agent on Arkiv, its record and our review of it. */
export interface MarketAgentView {
  address: string;
  name: string;
  skill: string;
  title: string | null;
  description: string;
  feeUnits: string;
  service: { model: string; promise: string; afterwards?: string } | null;
  delivered: number;
  disputes: number;
  rating: { average: number; count: number } | null;
  guestFields: ("bornOn" | "gender")[]; // what it gets of a traveller, besides name, email, phone
  review: AgentReviewView | null;
}

/** GET /market/agents/:address: one agent's page. */
export type AgentPageView = MarketAgentView & {
  form: {
    properties: Record<string, { type: string; description?: string }>;
    required: string[];
  } | null;
  endpointHost: string;
  hederaAccount: string | null;
  erc8004: {
    agentId: string;
    url: string;
    reputation: { count: number; average: number } | null; // verified people's ratings
    reporter: string | null; // who gave that feedback: our concierge
  } | null;
  links: { label: string; url: string }[];
};

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

/** A saved traveller: who a booking can be for (private to the account). */
export interface Traveller {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  bornOn: string | null; // flights need it
  gender: "f" | "m" | null; // as on the ID: flights need it
  isSelf: boolean;
}

/** A "prove you're a person" check: approved in the World ID app, judged by our server. */
export interface WorldCheck {
  id: string;
  status: "waiting" | "verified" | "denied" | "expired" | "failed" | "mismatch";
  reason?: string;
  used: boolean; // an approval of a hire works once
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

/** A one-time agent card, in a line: "•••• 4821 · Park Inn · ₹12,347 · charged". */
export const cardLine = (c: NonNullable<HireView["card"]>) =>
  `•••• ${c.last4} · ${c.merchant} · ${c.currency === "INR" ? `₹${Math.round(c.amount).toLocaleString("en-IN")}` : `${c.currency} ${c.amount}`} · ${
    { authorized: "on hold", captured: "charged", voided: "released" }[c.status]
  }`;
/** Escrowed price units (testnet scale, 1 unit = ₹1) → "₹12,347". */
export const rupeesOf = (units: string) => `₹${Number(units).toLocaleString("en-IN")}`;

/** 20000 → "0.02". */
/** "0.05"; a lookup's tiny fee keeps its digits: "0.001". */
export const usdc = (units: string | bigint) => {
  const n = Number(units) / 1e6;
  return n > 0 && n < 0.01 ? String(Number(n.toFixed(4))) : n.toFixed(2);
};
/** "★ 4.0 · 3 verified people": an agent's ratings by people who proved it with World ID. */
export const verifiedRating = (r: { average: number; count: number }) =>
  `★ ${r.average.toFixed(1)} · ${r.count} verified ${r.count === 1 ? "person" : "people"}`;
export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** HashScan opens a transaction by its Hedera id (0.0.x@seconds.nanos). */
export const hashscanTx = (tx: string) => `https://hashscan.io/testnet/transaction/${tx}`;
export const hashscanAccount = (id: string) => `https://hashscan.io/testnet/account/${id}`;
