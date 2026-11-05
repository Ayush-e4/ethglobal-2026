// Live walkthrough on testnet: a spending limit, a payment held with an undo window, a cancel,
// a delivery and a payout, plus the refusals that matter. Uses the operator as the owner (it
// holds the test USDC), a fresh agent key, a fresh hotel account and the relayer to submit.
// Run: pnpm --filter @app/mandates demo

import { account, createAccount, createClient, hashscan, loadConfig, NETWORKS } from "@app/hedera";
import { formatUsdc, parseUsdc } from "@app/shared";
import { type Hex, keccak256, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  type EscrowAuth,
  MandateClient,
  randomNonce,
  registryAddress,
  signEscrow,
  tokenIdToEvmAddress,
} from "../src";

const config = loadConfig();
const net = NETWORKS[config.network];
const link = hashscan(config.network);
const usdc = tokenIdToEvmAddress(net.usdcTokenId);
const registry = new MandateClient(registryAddress());
const owner = privateKeyToAccount(`0x${account(config, "operator").key}`);
const relayer = privateKeyToAccount(`0x${account(config, "relayer").key}`);
const agent = privateKeyToAccount(generatePrivateKey()); // only signs; never needs HBAR
const now = () => BigInt(Math.floor(Date.now() / 1000));
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
const step = (msg: string, tx?: Hex) => console.log(`✓ ${msg}${tx ? `  ${link.tx(tx)}` : ""}`);
const refused = async (msg: string, err: Promise<string | null>) => {
  const name = await err;
  if (!name) throw new Error(`expected a refusal: ${msg}`);
  console.log(`✓ ${msg}: refused (${name})`);
};

const client = createClient(config.network, account(config, "operator"));
const hotelAccount = await createAccount(client, { initialHbar: 5, memo: "demo hotel" });
client.close();
const hotel = privateKeyToAccount(`0x${hotelAccount.key}`);
step(`hotel account ${hotelAccount.id} (${hotel.address})`);

const budget = parseUsdc("0.10");
if ((await registry.allowance(usdc, owner.address)) < budget) {
  step(
    "owner lets the registry pull up to 0.10 USDC",
    (await registry.approve(owner, usdc, budget)).transactionHash,
  );
}
const { id, receipt } = await registry.createMandate(owner, {
  agent: agent.address,
  token: usdc,
  budget,
  perPaymentCap: parseUsdc("0.05"),
  expiresAt: now() + BigInt(3600),
  payees: [hotel.address],
});
step(`limit #${id}: 0.10 USDC, 0.05 per payment, this hotel only`, receipt.transactionHash);

async function hold(amount: string, undoSeconds: number) {
  const auth: EscrowAuth = {
    mandateId: id,
    payTo: hotel.address,
    amount: parseUsdc(amount),
    nonce: randomNonce(),
    validBefore: now() + BigInt(300),
    undoSeconds,
    deliverBy: now() + BigInt(3600),
    reviewSeconds: 120,
  };
  const signature = await signEscrow(agent, registry.domain(), auth);
  return { auth, signature, ...(await registry.payIntoEscrow(relayer, auth, signature)) };
}

// 1. Held, then undone.
const first = await hold("0.02", 60);
step(
  `agent pays 0.02 into escrow, 60 s undo window (relayer paid the fee)`,
  first.receipt.transactionHash,
);
console.log(`  remaining on the limit: ${formatUsdc(await registry.remaining(id))} USDC`);
await refused("the relayer tries to cancel", registry.check(relayer.address, "cancel", [first.id]));
await refused(
  "the hotel tries to deliver during the window",
  registry.check(hotel.address, "markDelivered", [first.id, toHex(0, { size: 32 })]),
);
step("owner cancels within the window", (await registry.cancel(owner, first.id)).transactionHash);
console.log(
  `  escrow: ${(await registry.getEscrow(first.id)).state}; remaining: ${formatUsdc(await registry.remaining(id))} USDC`,
);

// 2. Held, the window passes, delivered, paid out.
const second = await hold("0.02", 15);
step("agent pays 0.02 into escrow, 15 s undo window", second.receipt.transactionHash);
const startsAt = (await registry.getEscrow(second.id)).startsAt;
await sleep(Number(startsAt - now()) + 5);
const done = await registry.markDelivered(hotel, second.id, keccak256(toHex("booking DEMO-1")));
step("window over: the hotel marks it delivered", done.transactionHash);
await refused(
  "owner tries to cancel after delivery",
  registry.check(owner.address, "cancel", [second.id]),
);
step(
  "owner releases: the hotel is paid",
  (await registry.release(owner, second.id)).transactionHash,
);
console.log(`  escrow: ${(await registry.getEscrow(second.id)).state}`);

// 3. Payments the contract refuses.
const tampered = { ...second.auth, nonce: randomNonce() };
const sig = await signEscrow(agent, registry.domain(), tampered);
await refused(
  "relayer submits a bigger amount than the agent signed",
  registry.check(relayer.address, "payIntoEscrow", [
    { ...tampered, amount: parseUsdc("0.04") },
    sig,
  ]),
);
await refused(
  "relayer removes the undo window",
  registry.check(relayer.address, "payIntoEscrow", [{ ...tampered, undoSeconds: 0 }, sig]),
);
const over = { ...tampered, nonce: randomNonce(), amount: parseUsdc("0.06") };
await refused(
  "agent signs more than the per-payment cap",
  registry.check(relayer.address, "payIntoEscrow", [
    over,
    await signEscrow(agent, registry.domain(), over),
  ]),
);
