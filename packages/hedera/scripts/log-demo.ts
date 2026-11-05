// Writes one entry to the public log as the log writer and reads it back from the mirror node,
// then shows that the operator's key is refused. Costs a fraction of a cent in HBAR.
// Run: pnpm --filter @app/hedera run log-demo
import {
  account,
  createClient,
  hashscan,
  loadConfig,
  Mirror,
  NETWORKS,
  submitMessage,
} from "../src";

const config = loadConfig();
const topicId = config.spendLogTopicId;
if (!topicId) throw new Error("No public log yet: run pnpm setup:testnet");
const writer = account(config, "logWriter");
const operator = account(config, "operator");
const link = hashscan(config.network);

const entry = { type: "test", note: "log-demo", at: new Date().toISOString() };
const client = createClient(config.network, writer);
const { sequence, transactionId } = await submitMessage(client, {
  topicId,
  message: entry,
  writerKey: writer.key,
});
client.close();
console.log(`wrote entry #${sequence}: ${link.tx(transactionId)}`);

const mirror = new Mirror(NETWORKS[config.network].mirrorUrl);
for (let i = 0; i < 15; i++) {
  const found = (await mirror.topicMessages(topicId, 5)).find((m) => m.sequence === sequence);
  if (found) {
    console.log(`read back #${found.sequence} at ${found.timestamp}: ${found.text}`);
    break;
  }
  await new Promise((r) => setTimeout(r, 2000));
}

const opClient = createClient(config.network, operator);
try {
  await submitMessage(opClient, { topicId, message: { type: "test" }, writerKey: operator.key });
  console.log("✗ the operator could write to the log: that's wrong");
  process.exitCode = 1;
} catch (e) {
  console.log(
    `✓ the operator's key is refused: ${e instanceof Error ? e.message.split("\n")[0] : e}`,
  );
} finally {
  opClient.close();
}
