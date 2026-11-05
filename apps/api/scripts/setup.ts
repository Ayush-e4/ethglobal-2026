// Makes the concierge's signing key (once). It only ever signs payments a spending limit allows;
// it needs no Hedera account and no HBAR. The key goes straight into .env, never on screen.
// Run: pnpm --filter @app/api hiring-setup
import { resolve } from "node:path";
import { upsertEnv } from "@app/hedera";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ENV_PATH = resolve(import.meta.dirname, "../../../.env");
let key = process.env.CONCIERGE_PRIVATE_KEY as `0x${string}` | undefined;
if (!key) {
  key = generatePrivateKey();
  upsertEnv(ENV_PATH, { CONCIERGE_PRIVATE_KEY: key });
  console.log("created the concierge's signing key (saved in .env)");
}
console.log(`concierge  ${privateKeyToAccount(key).address}`);
console.log(
  process.env.DEMO_WALLET_ACCOUNT_ID
    ? `demo wallet ${process.env.DEMO_WALLET_ACCOUNT_ID}`
    : "demo wallet missing: run pnpm setup:testnet",
);
