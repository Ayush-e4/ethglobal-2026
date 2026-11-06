// Signs up on a running API with a software passkey (standing in for Face ID), then waits for
// the account's Face ID wallet to be made on Hedera testnet and shows it. Costs the sponsor about
// 3 HBAR and the gift. Set SESSION_OUT=<file> to keep the session cookie (to look in a browser).
// Run: pnpm --filter @app/api wallet-signup-demo
import { writeFileSync } from "node:fs";
import { softPasskey } from "../src/test/passkey";

const API = process.env.API_URL ?? "http://localhost:8787";
const ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3000";
const post = (path: string, body: unknown, cookie = "") =>
  fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });

const device = softPasskey(ORIGIN);
const options = (await (await post("/auth/passkey/register-options", {})).json()) as {
  challenge: string;
};
const res = await post("/auth/passkey/register", {
  response: device.register(options.challenge),
  label: "software passkey",
});
if (!res.ok) throw new Error(`sign-up failed: HTTP ${res.status}`);
const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
if (process.env.SESSION_OUT) writeFileSync(process.env.SESSION_OUT, cookie, { mode: 0o600 });
console.log(`✓ signed up with a passkey (account ${((await res.json()) as { id: string }).id})`);

const started = Date.now();
type Wallet = {
  status: string;
  address: string;
  hederaId: string | null;
  usdcUnits: string | null;
};
for (;;) {
  const { wallet } = (await (await fetch(`${API}/wallet`, { headers: { cookie } })).json()) as {
    wallet: Wallet | null;
  };
  if (wallet && wallet.status !== "creating") {
    const secs = Math.round((Date.now() - started) / 1000);
    console.log(`${wallet.status === "ready" ? "✓" : "✗"} wallet ${wallet.status} in ${secs}s`);
    console.log(`  ${wallet.address}  https://hashscan.io/testnet/account/${wallet.hederaId}`);
    console.log(`  ${Number(wallet.usdcUnits ?? 0) / 1e6} test USDC`);
    process.exit(wallet.status === "ready" ? 0 : 1);
  }
  if (Date.now() - started > 120_000) throw new Error("no wallet after 2 minutes");
  await new Promise((r) => setTimeout(r, 2000));
}
