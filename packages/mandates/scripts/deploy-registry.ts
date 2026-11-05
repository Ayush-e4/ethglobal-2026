// Deploys MandateRegistry (from `forge build`) as the operator, lets it hold test USDC (escrow
// needs that on Hedera) and saves its address in .env.
// Run: pnpm --filter @app/contracts build && pnpm --filter @app/mandates deploy-registry
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { account, hashscan, loadConfig, NETWORKS, upsertEnv } from "@app/hedera";
import { privateKeyToAccount } from "viem/accounts";
import { MandateClient, tokenIdToEvmAddress } from "../src";
import { deployRegistry } from "../src/deploy";

const config = loadConfig();
const net = NETWORKS[config.network];
const link = hashscan(config.network);
const deployer = privateKeyToAccount(`0x${account(config, "operator").key}`);
const artifact = fileURLToPath(
  new URL("../../contracts/out/MandateRegistry.sol/MandateRegistry.json", import.meta.url),
);

const d = await deployRegistry(deployer, artifact, net.mirrorUrl);
console.log(
  `deployed  ${d.address} (${d.contractId}): ${net.hashscanUrl}/contract/${d.contractId}`,
);
const assoc = await new MandateClient(d.address).associate(
  deployer,
  tokenIdToEvmAddress(net.usdcTokenId),
);
console.log(`can hold USDC: ${link.tx(assoc.transactionHash)}`);
upsertEnv(resolve(import.meta.dirname, "../../../.env"), {
  MANDATE_REGISTRY_ADDRESS: d.address,
  MANDATE_REGISTRY_ID: d.contractId,
});
console.log("saved MANDATE_REGISTRY_ADDRESS and MANDATE_REGISTRY_ID in .env");
