// Checks every role's account and the public log, read-only. Exits 1 if something's off.
// Run: pnpm --filter @app/hedera status

import { formatUsdc } from "@app/shared";
import { PrivateKey } from "@hiero-ledger/sdk";
import { formatHbar, hashscan, loadConfig, Mirror, NETWORKS, ROLES, type Role } from "../src";

const config = loadConfig();
const net = NETWORKS[config.network];
const link = hashscan(config.network);
const mirror = new Mirror(net.mirrorUrl);
let ok = true;
const fail = (msg: string) => {
  ok = false;
  console.log(`  ✗ ${msg}`);
};

console.log(`network ${config.network}\n`);
for (const role of Object.keys(ROLES) as Role[]) {
  const a = config.roles[role];
  console.log(`${role}: ${ROLES[role].job}`);
  console.log(`  can't: ${ROLES[role].cannot}`);
  if (!a) {
    fail("not set up yet (pnpm setup:testnet)");
    continue;
  }
  const b = await mirror.balances(a.id);
  if (!b) {
    fail(`${a.id} doesn't exist on ${config.network}`);
    continue;
  }
  const usdc = b.tokens[net.usdcTokenId];
  console.log(
    `  ${a.id}  ${formatHbar(b.tinybars)}  ${usdc === undefined ? "no USDC" : `${formatUsdc(usdc)} USDC`}`,
  );
  console.log(`  ${link.account(a.id)}`);
  if (b.tinybars < BigInt(100_000_000)) fail("under 1 HBAR left for fees");
}

console.log("\npublic log");
if (!config.spendLogTopicId) fail("not set up yet (pnpm setup:testnet)");
else {
  const t = await mirror.topic(config.spendLogTopicId);
  console.log(`  ${t.id} "${t.memo}"  ${link.topic(t.id)}`);
  if (t.adminKey === null) console.log("  ✓ no admin key: nobody can delete or change it");
  else fail("it has an admin key, so someone could delete it");
  const writer = config.roles.logWriter;
  const writerPub = writer && PrivateKey.fromStringECDSA(writer.key).publicKey.toStringRaw();
  if (writerPub && t.submitKey === writerPub) console.log("  ✓ only the log writer can write");
  else fail("its submit key isn't the log writer's");
  const [last] = await mirror.topicMessages(t.id, 1);
  console.log(
    `  ${last ? `${last.sequence} entries, last at ${last.timestamp}` : "no entries yet"}`,
  );
}
process.exit(ok ? 0 : 1);
