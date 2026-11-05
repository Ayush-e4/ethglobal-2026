// Pays 0.01 USDC from the operator to a brand-new account and checks it arrived, then shows that
// the relayer can't move the operator's USDC without the operator's key.
// Needs test USDC on the operator (faucet.circle.com, Hedera Testnet).
// Run: pnpm --filter @app/hedera pay-demo
import { formatUsdc, parseUsdc } from "@app/shared";
import {
  account,
  createAccount,
  createClient,
  hashscan,
  loadConfig,
  Mirror,
  NETWORKS,
  transferToken,
} from "../src";

const config = loadConfig();
const net = NETWORKS[config.network];
const link = hashscan(config.network);
const mirror = new Mirror(net.mirrorUrl);
const operator = account(config, "operator");
const relayer = account(config, "relayer");
const amount = parseUsdc("0.01");

const has = (await mirror.balances(operator.id))?.tokens[net.usdcTokenId] ?? BigInt(0);
if (has < amount) throw new Error("The operator has no test USDC: get some at faucet.circle.com");

const client = createClient(config.network, operator);
try {
  const payee = await createAccount(client, { initialHbar: 1, memo: "ethglobal-2026 pay-demo" });
  console.log(`payee ${payee.id} created: ${link.account(payee.id)}`);
  const tx = await transferToken(client, {
    tokenId: net.usdcTokenId,
    from: operator.id,
    to: payee.id,
    units: amount,
    memo: "pay-demo",
  });
  console.log(`paid ${formatUsdc(amount)} USDC: ${link.tx(tx)}`);
  for (let i = 0; i < 15; i++) {
    const got = (await mirror.balances(payee.id))?.tokens[net.usdcTokenId];
    if (got !== undefined && got > BigInt(0)) {
      console.log(`✓ payee holds ${formatUsdc(got)} USDC`);
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
} finally {
  client.close();
}

const relayerClient = createClient(config.network, relayer);
try {
  await transferToken(relayerClient, {
    tokenId: net.usdcTokenId,
    from: operator.id,
    to: relayer.id,
    units: amount,
  });
  console.log("✗ the relayer moved the operator's USDC: that's wrong");
  process.exitCode = 1;
} catch (e) {
  console.log(`✓ the relayer can't move it: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
} finally {
  relayerClient.close();
}
