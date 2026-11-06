// Gives each of our agents (StayWise, PriceGuard, SkyHop, Bank Check) its own key: a Hedera account (paid into, marks
// deliveries) whose alias is also its Arkiv writer. Funded from the operator (HBAR) and our
// Arkiv writer (test GLM). Safe to re-run (tops up HBAR running low); keys go straight into
// .env, never on screen.
// Run: pnpm --filter @app/agents agents-setup
import { resolve } from "node:path";
import { ARKIV_CHAIN } from "@app/arkiv";
import {
  account,
  createAccount,
  createClient,
  formatHbar,
  hashscan,
  loadConfig,
  Mirror,
  NETWORKS,
  transferHbar,
  upsertEnv,
} from "@app/hedera";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  type Hex,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SKYHOP } from "../src/flights/config";
import { HOTEL_AGENTS } from "../src/hotels/config";
import { BANKCHECK } from "../src/lookups/bankcheck";

const ENV_PATH = resolve(import.meta.dirname, "../../../.env");
const config = loadConfig();
const link = hashscan(config.network);
const mirror = new Mirror(NETWORKS[config.network].mirrorUrl);
const arkiv = createPublicClient({
  chain: ARKIV_CHAIN,
  transport: http(undefined, { retryCount: 0 }),
});

for (const a of [...Object.values(HOTEL_AGENTS), SKYHOP, BANKCHECK]) {
  let key = process.env[`${a.env}_PRIVATE_KEY`] as Hex | undefined;
  let accountId = process.env[`${a.env}_ACCOUNT_ID`];
  if (!key || !accountId) {
    const client = createClient(config.network, account(config, "operator"));
    const made = await createAccount(client, { initialHbar: 30, memo: `${a.name} agent` });
    client.close();
    key = `0x${made.key}`;
    accountId = made.id;
    upsertEnv(ENV_PATH, { [`${a.env}_PRIVATE_KEY`]: key, [`${a.env}_ACCOUNT_ID`]: accountId });
    console.log(`${a.name} Hedera account ${accountId} with 30 HBAR: ${link.account(accountId)}`);
  } else {
    // Marking a job delivered (it schedules the payout) costs about 3 HBAR: keep 15 or more.
    const tinybars = (await mirror.balances(accountId))?.tinybars ?? BigInt(0);
    if (tinybars < BigInt(15 * 100_000_000)) {
      const operator = account(config, "operator");
      const client = createClient(config.network, operator);
      const tx = await transferHbar(client, { from: operator.id, to: accountId, hbar: 30 });
      client.close();
      console.log(`${a.name} Hedera account ${accountId} topped up with 30 HBAR: ${link.tx(tx)}`);
    } else console.log(`${a.name} Hedera account ${accountId}: ${formatHbar(tinybars)}`);
  }

  const address = privateKeyToAccount(key).address;
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
    console.log(`${a.name} Arkiv wallet ${address} funded with 0.5 test GLM`);
  } else console.log(`${a.name} Arkiv wallet ${address}: ${formatEther(balance)} test GLM`);
}
