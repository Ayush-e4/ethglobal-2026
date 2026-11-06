// Lab check for the zkML spend guard: deploys the EZKL verifier (labs/zkml-guard/evm) as the
// operator, then checks on Hedera testnet that a real proof passes and a tampered one fails.
// Run: pnpm --filter @app/mandates exec tsx --env-file=../../.env scripts/risk-verifier-check.ts <calldata.bin> [verifier address]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { account, loadConfig, NETWORKS } from "@app/hedera";
import {
  createPublicClient,
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  http,
  parseAbi,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hederaTestnet } from "../src";
import { deployArtifact } from "../src/deploy";

const [calldataPath, existing] = process.argv.slice(2);
if (!calldataPath)
  throw new Error("usage: risk-verifier-check.ts <calldata.bin> [verifier address]");

const config = loadConfig();
const net = NETWORKS[config.network];
const reader = createPublicClient({ chain: hederaTestnet, transport: http() });
const abi = parseAbi(["function verifyProof(bytes proof, uint256[] instances) returns (bool)"]);

let address = existing as Hex | undefined;
if (!address) {
  const deployer = privateKeyToAccount(`0x${account(config, "operator").key}`);
  const artifact = fileURLToPath(
    new URL(
      "../../../labs/zkml-guard/evm/out/RiskVerifier.sol/Halo2Verifier.json",
      import.meta.url,
    ),
  );
  const d = await deployArtifact(deployer, artifact, net.mirrorUrl);
  address = d.address;
  console.log(
    `verifier  ${d.address} (${d.contractId}): ${net.hashscanUrl}/contract/${d.contractId}`,
  );
}

const good = toHex(readFileSync(calldataPath));

async function check(label: string, data: Hex) {
  try {
    const raw = await reader.call({ to: address, data, gas: BigInt(14_000_000) });
    const ok = raw.data
      ? decodeFunctionResult({ abi, functionName: "verifyProof", data: raw.data })
      : false;
    console.log(`${label}: ${ok ? "ACCEPTED" : "rejected"}`);
    return ok;
  } catch (e) {
    console.log(`${label}: rejected (reverted: ${(e as Error).message.split("\n")[0]})`);
    return false;
  }
}

const goodOk = await check("real proof        ", good);
// The public values are the six payment facts then the risk score (fixed point, see
// settings.json). Claim a lower score, then different facts, with the same proof: both must fail.
const { args } = decodeFunctionData({ abi, data: good });
const [proof, instances] = args;
const [amount, ...restFacts] = instances.slice(0, -1);
const score = instances.at(-1);
if (amount === undefined || score === undefined) throw new Error("no public values in the proof");
console.log(`proved score (fixed point): ${score}`);
const lower = [...instances.slice(0, -1), score - 1n];
const badOk = await check(
  "score lowered by 1",
  encodeFunctionData({ abi, functionName: "verifyProof", args: [proof, lower] }),
);
const facts = [amount - 1n, ...restFacts, score];
const badFacts = await check(
  "amount changed    ",
  encodeFunctionData({ abi, functionName: "verifyProof", args: [proof, facts] }),
);

const gas = await reader.estimateGas({ to: address, data: good }).catch(() => null);
console.log(`gas to verify: ${gas ?? "estimate failed"}`);
if (!goodOk || badOk || badFacts) process.exit(1);
