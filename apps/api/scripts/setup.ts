// Makes the concierge's signing key (once) and gives it a little HBAR. It signs payments a
// spending limit allows, and sends one kind of transaction: undoing a held payment during its
// undo window (that only ever returns money to the limit). The key goes straight into .env,
// never on screen. Run: pnpm --filter @app/api hiring-setup
import { resolve } from "node:path";
import { account, loadConfig, upsertEnv } from "@app/hedera";
import { hederaTestnet } from "@app/mandates";
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ENV_PATH = resolve(import.meta.dirname, "../../../.env");
let key = process.env.CONCIERGE_PRIVATE_KEY as `0x${string}` | undefined;
if (!key) {
  key = generatePrivateKey();
  upsertEnv(ENV_PATH, { CONCIERGE_PRIVATE_KEY: key });
  console.log("created the concierge's signing key (saved in .env)");
}
const concierge = privateKeyToAccount(key).address;
console.log(`concierge  ${concierge}`);

// HBAR for its undo transactions, from the operator (sending to its address makes its account).
const reader = createPublicClient({ chain: hederaTestnet, transport: http() });
const hbar = await reader.getBalance({ address: concierge });
if (hbar < parseEther("3")) {
  const operator = privateKeyToAccount(`0x${account(loadConfig(), "operator").key}`);
  const hash = await createWalletClient({
    account: operator,
    chain: hederaTestnet,
    transport: http(),
  }).sendTransaction({ to: concierge, value: parseEther("10") });
  await reader.waitForTransactionReceipt({ hash });
  console.log(`           given 10 HBAR for undo transactions: ${hash}`);
} else console.log(`           holds ${formatEther(hbar)} HBAR`);

console.log(
  process.env.DEMO_WALLET_ACCOUNT_ID
    ? `demo wallet ${process.env.DEMO_WALLET_ACCOUNT_ID}`
    : "demo wallet missing: run pnpm setup:testnet",
);
