// Makes the platform's Arkiv writer wallet (once) and shows what it needs. The key goes straight
// into .env and is never printed. Read-only after that: balance and access-key checks.
// Run: pnpm --filter @app/arkiv arkiv-setup
import { resolve } from "node:path";
import { upsertEnv } from "@app/hedera";
import { formatEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arkivReader } from "../src/config";

const ENV_PATH = resolve(import.meta.dirname, "../../../.env");
let key = process.env.ARKIV_WRITER_PRIVATE_KEY;
if (!key) {
  key = generatePrivateKey();
  upsertEnv(ENV_PATH, { ARKIV_WRITER_PRIVATE_KEY: key });
  console.log("created the Arkiv writer wallet (key saved in .env)");
}
const address = privateKeyToAccount(key as `0x${string}`).address;
console.log(`writer      ${address}`);
console.log(
  `access key  ${process.env.ARKIV_ACCESS_KEY ? "set" : "missing: hub.arkiv.network/access-keys → ARKIV_ACCESS_KEY"}`,
);
try {
  const balance = await arkivReader().getBalance({ address });
  console.log(
    `balance     ${formatEther(balance)} test GLM${balance === BigInt(0) ? ' (fund it: hub.arkiv.network/faucet, "use a different address")' : ""}`,
  );
} catch {
  console.log("balance     couldn't read it (Rabdi unreachable or rate limited)");
}
