// One account on two devices, live on a running API (Hedera testnet). Software passkeys stand
// in for a phone and a laptop: the phone signs up (a wallet is made) and shows a code; the
// laptop joins with it; Face ID on the phone lets the laptop approve payments; then the laptop
// shuts itself out with its own Face ID, which the wallet accepts only if Hedera added its key.
// Run: pnpm --filter @app/api device-link-demo
import { softPasskey } from "../src/test/passkey";

const API = process.env.API_URL ?? "http://localhost:8787";
const ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3000";
const ok = (msg: string) => console.log(`✓ ${msg}`);
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

/** A device: its own passkey and its own session. */
function device() {
  const key = softPasskey(ORIGIN);
  let cookie = "";
  const call = async <T>(path: string, body?: unknown): Promise<{ status: number; json: T }> => {
    const res = await fetch(`${API}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    cookie = res.headers.get("set-cookie")?.split(";")[0] ?? cookie;
    return { status: res.status, json: (await res.json().catch(() => ({}))) as T };
  };
  /** Face ID for a device change: add or remove `id`. */
  const faceId = async (id: string, action: "add" | "remove") => {
    const prep = await call<{ opId: string; options: { challenge: string } }>(
      `/account/devices/${id}/wallet/face-id`,
      { action },
    );
    if (prep.status !== 200) throw new Error(`prepare: ${JSON.stringify(prep.json)}`);
    const done = await call<{ tx?: string; message?: string }>(`/account/devices/${id}/wallet`, {
      opId: prep.json.opId,
      response: key.signIn(prep.json.options.challenge),
    });
    if (done.status !== 200) throw new Error(`${action}: ${JSON.stringify(done.json)}`);
    return `https://hashscan.io/testnet/transaction/${done.json.tx}`;
  };
  return { key, call, faceId };
}

const phone = device();
const laptop = device();

// 1. The phone makes the account, and its wallet.
const { json: reg } = await phone.call<{ challenge: string }>("/auth/passkey/register-options", {});
await phone.call("/auth/passkey/register", { response: phone.key.register(reg.challenge) });
type Wallet = { status: string; hederaId: string | null };
let w: Wallet | null = null;
for (let i = 0; i < 60 && w?.status !== "ready"; i++) {
  if (i) await sleep(2);
  w = (await phone.call<{ wallet: Wallet | null }>("/wallet")).json.wallet;
}
if (w?.status !== "ready") throw new Error("no wallet");
ok(`phone signed up; Face ID wallet ${w.hederaId}`);

// 2. The phone shows a code; the laptop makes its own passkey on the account with it.
const { json: link } = await phone.call<{ code: string }>("/account/devices/link", {});
const { json: found } = await laptop.call<{ options: { challenge: string } }>(
  "/auth/passkey/link/options",
  { code: link.code },
);
const joined = await laptop.call("/auth/passkey/link", {
  code: link.code,
  response: laptop.key.register(found.options.challenge),
});
const same =
  (await laptop.call<{ id: string }>("/me")).json.id ===
  (await phone.call<{ id: string }>("/me")).json.id;
ok(`laptop joined with code ${link.code} (HTTP ${joined.status}); same account: ${same}`);

// 3. Face ID on the phone lets the laptop approve payments.
ok(`phone let the laptop in  ${await phone.faceId(laptop.key.id, "add")}`);

// 4. The laptop shuts itself out with its own Face ID: the wallet checks the laptop's key.
ok(`laptop shut itself out with its own Face ID  ${await laptop.faceId(laptop.key.id, "remove")}`);
const phoneIn = (await phone.call("/me")).status === 200;
const laptopIn = (await laptop.call("/me")).status === 200;
const left = (await phone.call<{ id: string }[]>("/account/devices")).json.length;
ok(`phone still signed in: ${phoneIn}; laptop signed out: ${!laptopIn}; devices left: ${left}`);
process.exit(same && phoneIn && !laptopIn && left === 1 ? 0 : 1);
