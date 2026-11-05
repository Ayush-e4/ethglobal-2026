// Sets up testnet from the operator account: USDC opt-in, one account per role, the public log.
// Safe to re-run: it only creates what's missing. New keys go straight into .env, never on screen.
// Run: pnpm setup:testnet
import { resolve } from "node:path";
import {
  account,
  associateToken,
  createAccount,
  createClient,
  createTopic,
  formatHbar,
  hashscan,
  loadConfig,
  Mirror,
  NETWORKS,
  ROLES,
  type Role,
  upsertEnv,
} from "../src";

const ENV_PATH = resolve(import.meta.dirname, "../../../.env");
const config = loadConfig();
const net = NETWORKS[config.network];
const link = hashscan(config.network);
const mirror = new Mirror(net.mirrorUrl);

const operator = account(config, "operator");
const op = await mirror.balances(operator.id);
if (!op) throw new Error(`The operator ${operator.id} doesn't exist on ${config.network}`);
console.log(`operator    ${operator.id}  ${formatHbar(op.tinybars)}`);

// Starting HBAR per role: the relayer pays everyone's fees, the log writer only its own.
const FUNDING: Partial<Record<Role, number>> = { relayer: 20, logWriter: 5 };
const client = createClient(config.network, operator);
try {
  if (net.usdcTokenId in op.tokens) console.log(`usdc        operator can hold ${net.usdcTokenId}`);
  else {
    const tx = await associateToken(client, operator, net.usdcTokenId);
    console.log(`usdc        operator opted in to ${net.usdcTokenId}: ${link.tx(tx)}`);
  }

  for (const [role, hbar] of Object.entries(FUNDING) as [Role, number][]) {
    const existing = config.roles[role];
    if (existing) {
      console.log(`${role.padEnd(11)} ${existing.id} (already set up)`);
      continue;
    }
    const a = await createAccount(client, { initialHbar: hbar, memo: `ethglobal-2026 ${role}` });
    // Saved right away, so a failure further down never loses a key.
    upsertEnv(ENV_PATH, {
      [`${ROLES[role].env}_ACCOUNT_ID`]: a.id,
      [`${ROLES[role].env}_PRIVATE_KEY`]: a.key,
    });
    config.roles[role] = { id: a.id, key: a.key };
    console.log(`${role.padEnd(11)} ${a.id} created with ${hbar} HBAR: ${link.account(a.id)}`);
  }

  if (config.spendLogTopicId) console.log(`log         ${config.spendLogTopicId} (already set up)`);
  else {
    const writer = account(config, "logWriter");
    const { topicId } = await createTopic(client, {
      memo: "ethglobal-2026 public spend log",
      writerKey: writer.key,
    });
    upsertEnv(ENV_PATH, { SPEND_LOG_TOPIC_ID: topicId });
    console.log(`log         ${topicId} created (no admin key): ${link.topic(topicId)}`);
  }
} finally {
  client.close();
}
console.log("\nDone. Check everything with: pnpm --filter @app/hedera status");
