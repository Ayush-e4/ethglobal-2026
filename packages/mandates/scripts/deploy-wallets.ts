// Deploys the PasskeyWalletFactory (from `forge build`) as the operator and saves its address in
// .env. It has no owner: anyone may make a wallet with it, and each wallet answers only to its
// passkeys. Run: pnpm --filter @app/contracts build && pnpm --filter @app/mandates deploy-wallets
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { account, loadConfig, NETWORKS, upsertEnv } from "@app/hedera";
import { privateKeyToAccount } from "viem/accounts";
import { deployArtifact } from "../src/deploy";

const config = loadConfig();
const net = NETWORKS[config.network];
const deployer = privateKeyToAccount(`0x${account(config, "operator").key}`);
const artifact = fileURLToPath(
  new URL(
    "../../contracts/out/PasskeyWalletFactory.sol/PasskeyWalletFactory.json",
    import.meta.url,
  ),
);

const d = await deployArtifact(deployer, artifact, net.mirrorUrl);
console.log(
  `deployed  ${d.address} (${d.contractId}): ${net.hashscanUrl}/contract/${d.contractId}`,
);
upsertEnv(resolve(import.meta.dirname, "../../../.env"), {
  PASSKEY_WALLET_FACTORY_ADDRESS: d.address,
  PASSKEY_WALLET_FACTORY_ID: d.contractId,
});
console.log("saved PASSKEY_WALLET_FACTORY_ADDRESS and PASSKEY_WALLET_FACTORY_ID in .env");
