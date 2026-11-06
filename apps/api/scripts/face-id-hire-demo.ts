// Hiring from your own Face ID wallet, live on a running API (Hedera testnet, LiteAPI sandbox).
// A software passkey stands in for Face ID: it signs up (a wallet is made), asks for a hotel,
// approves the agent's spending limit with "Face ID", and the agent is paid from the wallet:
// held, booked, then paid out by Hedera; then Face ID cancels the limit. About 4 minutes.
// Test travellers only.
// Run: pnpm --filter @app/api face-id-hire-demo
import { softPasskey } from "../src/test/passkey";

const API = process.env.API_URL ?? "http://localhost:8787";
const ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3000";
const device = softPasskey(ORIGIN);
let cookie = "";
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
const ok = (msg: string) => console.log(`✓ ${msg}`);

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  cookie = res.headers.get("set-cookie")?.split(";")[0] ?? cookie;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${JSON.stringify(json)}`);
  return json as T;
}

type Card = { type: string; [k: string]: unknown };
/** Sends a chat message and returns the cards in the streamed reply. */
async function say(chatId: string, text: string): Promise<Card[]> {
  const res = await fetch(`${API}/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ text }),
  });
  const cards: Card[] = [];
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data:")) continue;
    const e = JSON.parse(line.slice(5)) as { type: string; card?: Card };
    if (e.type === "card" && e.card) cards.push(e.card);
  }
  return cards;
}

type Wallet = { status: string; hederaId: string | null; usdcUnits: string | null };
const wallet = async () => (await call<{ wallet: Wallet | null }>("/wallet")).wallet;
const usdc = (units: string | null) => (Number(units ?? 0) / 1e6).toFixed(2);

// 1. Sign up with a passkey: a wallet is made, with a little test USDC.
const { challenge } = await call<{ challenge: string }>("/auth/passkey/register-options", {});
await call("/auth/passkey/register", { response: device.register(challenge) });
let w = await wallet();
for (let i = 0; i < 60 && w?.status !== "ready"; i++) {
  await sleep(2);
  w = await wallet();
}
if (w?.status !== "ready") throw new Error("no wallet");
ok(`signed up; Face ID wallet ${w.hederaId} holds ${usdc(w.usdcUnits)} test USDC`);

// 2. Ask for a hotel, then book the first quote: the agent needs a limit first.
const chat = await call<{ id: string }>("/chats", {});
const quotes = await say(chat.id, "Hotel quotes in Goa for 2 adults, 22 to 24 December");
if (!quotes.some((c) => c.type === "quotes")) throw new Error("no quotes");
ok("got live quotes");
const asked = (await say(chat.id, "Book the first one")).find((c) => c.type === "limit");
if (!asked) throw new Error("expected the Face ID limit card");
ok(
  `the concierge asks for a limit: up to ${usdc(asked.budgetUnits as string)} USDC for ${asked.agentName}`,
);

// 3. "Face ID": the device signs the wallet's batch; the wallet sets the limit on Hedera.
const prepared = await call<{ opId: string; options: { challenge: string } }>(
  `/chats/${chat.id}/limits/face-id`,
  { payee: asked.payee },
);
const set = await call<{ mandateId: string; tx: string }>(`/chats/${chat.id}/limits`, {
  opId: prepared.opId,
  response: device.signIn(prepared.options.challenge),
});
ok(`Face ID approved limit #${set.mandateId}  https://hashscan.io/testnet/transaction/${set.tx}`);

// 4. The booking carries on, paid from the wallet's own limit.
const hired = (await say(chat.id, asked.reply as string)).find((c) => c.type === "hire");
if (!hired) throw new Error("expected a hire card");
ok(`hired; fee held  https://hashscan.io/testnet/transaction/${hired.payTx}`);

// 5. Follow it: held → delivered (booking reference) → released by Hedera.
type Hire = { id: string; status: string; bookingRef: string | null };
let last = "";
for (let i = 0; i < 120; i++) {
  const h = (await call<Hire[]>(`/chats/${chat.id}/hires`)).find((x) => x.id === hired.hireId);
  if (h && h.status !== last) {
    last = h.status;
    console.log(`  ${h.status}${h.bookingRef ? ` (booking ${h.bookingRef})` : ""}`);
  }
  if (h && ["released", "cancelled", "refunded", "failed"].includes(h.status)) break;
  await sleep(5);
}
w = await wallet();
ok(`done: ${last}; the wallet now holds ${usdc(w?.usdcUnits ?? null)} test USDC`);

// 6. The limit is listed on the wallet; Face ID cancels it, and Hedera says it's revoked.
type Limit = { id: string; status: string; remainingUnits: string | null };
const [limit] = await call<Limit[]>("/wallet/limits");
if (!limit) throw new Error("no limit listed");
ok(`listed: ${limit.status}, ${usdc(limit.remainingUnits)} USDC left`);
const cancel = await call<{ opId: string; options: { challenge: string } }>(
  `/wallet/limits/${limit.id}/revoke/face-id`,
  {},
);
const revoked = await call<{ tx: string }>(`/wallet/limits/${limit.id}/revoke`, {
  opId: cancel.opId,
  response: device.signIn(cancel.options.challenge),
});
const [after] = await call<Limit[]>("/wallet/limits");
ok(`Face ID cancelled it: ${after?.status}  https://hashscan.io/testnet/transaction/${revoked.tx}`);
process.exit(last === "released" && after?.status === "cancelled" ? 0 : 1);
