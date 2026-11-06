// Face ID wallets, live on Hedera testnet. A phone's passkey makes a wallet; only its passkeys
// can move what's in it. It sets a spending limit, refuses a stranger and a tampered batch, lets
// a laptop in, and shuts the laptop out again. Software passkeys stand in for Face ID; the
// operator submits every transaction (and pays the gas) but decides nothing.
// Run: pnpm --filter @app/mandates wallet-demo
import { account, hashscan, loadConfig, NETWORKS } from "@app/hedera";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  addKeyCalls,
  erc20Abi,
  hederaTestnet,
  limitCalls,
  MandateClient,
  PasskeyWalletClient,
  registryAddress,
  removeKeyCalls,
  revertName,
  revokeCalls,
  tokenIdToEvmAddress,
  type WalletCall,
  walletFactoryAddress,
} from "../src";
import { softwarePasskey } from "./software-passkey";

const config = loadConfig();
const net = NETWORKS[config.network];
const link = hashscan(config.network);
const sender = privateKeyToAccount(`0x${account(config, "operator").key}`);
const usdc = tokenIdToEvmAddress(net.usdcTokenId);
const registry = new MandateClient(registryAddress());
const registryAt = registryAddress();
const wallets = new PasskeyWalletClient(walletFactoryAddress());

const phone = softwarePasskey();
const laptop = softwarePasskey();
type Device = typeof phone;
const now = () => BigInt(Math.floor(Date.now() / 1000));

async function run(device: Device, calls: WalletCall[], submit = calls) {
  const deadline = now() + BigInt(600);
  const d = await wallets.digest(wallet, calls, deadline);
  const sig = { qx: device.qx, qy: device.qy, sig: device.faceId(d) };
  return wallets.execute(sender, wallet, submit, deadline, sig);
}
async function refused(device: Device, calls: WalletCall[], submit = calls) {
  try {
    await run(device, calls, submit);
  } catch (e) {
    return revertName(e);
  }
  throw new Error("it should have been refused");
}
const limit = (budget: bigint) =>
  limitCalls(registryAt, {
    agent: sender.address,
    token: usdc,
    budget,
    perPaymentCap: budget,
    expiresAt: now() + BigInt(3600),
    payees: [],
  });

console.log("1. The phone's passkey makes a wallet, at an address known in advance");
const expected = await wallets.addressOf(phone);
const wallet = await wallets.create(sender, phone, usdc);
const gift = await createWalletClient({
  account: sender,
  chain: hederaTestnet,
  transport: http(),
}).writeContract({
  address: usdc,
  abi: erc20Abi,
  functionName: "transfer",
  args: [wallet, 50_000n],
});
await wallets.publicClient.waitForTransactionReceipt({ hash: gift });
console.log(`   ${wallet} (as computed: ${wallet === expected}), given 0.05 test USDC`);
console.log(`   ${link.tx(gift)}`);

console.log("2. A stranger's passkey tries to set a limit");
console.log(`   refused: ${await refused(laptop, limit(20_000n))}`);

console.log("3. The phone approves a 0.02 limit, but someone submits 0.05 instead");
console.log(`   refused: ${await refused(phone, limit(20_000n), limit(50_000n))}`);

console.log("4. Face ID on the phone sets the 0.02 limit");
const set = await run(phone, limit(20_000n));
const id = set.mandateId ?? 0n;
const m = await registry.getMandate(id);
console.log(`   limit #${id}, owned by the wallet: ${m.owner === wallet}  ${link.tx(set.hash)}`);

console.log("5. The phone lets the laptop in; the laptop cancels the limit");
const added = await run(phone, addKeyCalls(wallet, laptop));
console.log(`   laptop is a key: ${await wallets.hasKey(wallet, laptop)}  ${link.tx(added.hash)}`);
const revoked = await run(laptop, revokeCalls(registryAt, id));
console.log(`   cancelled: ${(await registry.getMandate(id)).revoked}  ${link.tx(revoked.hash)}`);

console.log("6. The laptop is lost: the phone shuts it out");
const removed = await run(phone, removeKeyCalls(wallet, laptop));
console.log(
  `   laptop is a key: ${await wallets.hasKey(wallet, laptop)}  ${link.tx(removed.hash)}`,
);
console.log(`   the laptop setting a limit now: ${await refused(laptop, limit(10_000n))}`);
