// Gives StayWise its own key: a Hedera account (paid into, marks deliveries) whose alias is
// also its Arkiv writer. Funded from the operator (HBAR) and our Arkiv writer (test GLM). Safe
// to re-run; keys go straight into .env, never on screen.
// Run: pnpm --filter @app/agents agents-setup
import { resolve } from "node:path";
import { ARKIV_CHAIN } from "@app/arkiv";
import { account, createAccount, createClient, hashscan, loadConfig, upsertEnv } from "@app/hedera";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  type Hex,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ENV_PATH = resolve(import.meta.dirname, "../../../.env");
const config = loadConfig();
const link = hashscan(config.network);

let key = process.env.STAYWISE_PRIVATE_KEY as Hex | undefined;
let accountId = process.env.STAYWISE_ACCOUNT_ID;
if (!key || !accountId) {
  const client = createClient(config.network, account(config, "operator"));
  const a = await createAccount(client, { initialHbar: 30, memo: "StayWise agent" });
  client.close();
  key = `0x${a.key}`;
  accountId = a.id;
  upsertEnv(ENV_PATH, { STAYWISE_PRIVATE_KEY: key, STAYWISE_ACCOUNT_ID: accountId });
  console.log(`StayWise Hedera account ${accountId} with 30 HBAR: ${link.account(accountId)}`);
} else console.log(`StayWise Hedera account ${accountId} (already set up)`);

const address = privateKeyToAccount(key).address;
const arkiv = createPublicClient({
  chain: ARKIV_CHAIN,
  transport: http(undefined, { retryCount: 0 }),
});
const balance = await arkiv.getBalance({ address });
if (balance < parseEther("0.1")) {
  const writerKey = process.env.ARKIV_WRITER_PRIVATE_KEY as Hex | undefined;
  if (!writerKey)
    throw new Error("ARKIV_WRITER_PRIVATE_KEY missing: run pnpm --filter @app/arkiv arkiv-setup");
  const hash = await createWalletClient({
    chain: ARKIV_CHAIN,
    transport: http(undefined, { retryCount: 0 }),
    account: privateKeyToAccount(writerKey),
  }).sendTransaction({ to: address, value: parseEther("0.5") });
  await arkiv.waitForTransactionReceipt({ hash });
  console.log(`StayWise Arkiv wallet ${address} funded with 0.5 test GLM`);
} else console.log(`StayWise Arkiv wallet ${address}: ${formatEther(balance)} test GLM`);
