import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, type Hex, http, type LocalAccount } from "viem";
import { hederaTestnet } from "./chain";

/**
 * Deploys a contract from Foundry's build output (ours take no constructor arguments, and have
 * no owner and no admin: once deployed, nobody can change them). Returns its EVM address and
 * its Hedera id (0.0.x).
 */
export async function deployArtifact(
  deployer: LocalAccount,
  artifactPath: string,
  mirrorUrl: string,
): Promise<{ address: `0x${string}`; contractId: string; txHash: Hex }> {
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as { bytecode: { object: Hex } };
  const wallet = createWalletClient({ account: deployer, chain: hederaTestnet, transport: http() });
  const reader = createPublicClient({ chain: hederaTestnet, transport: http() });
  const txHash = await wallet.deployContract({
    abi: [],
    bytecode: artifact.bytecode.object,
    gas: BigInt(5_000_000),
  });
  const receipt = await reader.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`deploy failed: ${txHash}`);
  }
  const address = receipt.contractAddress;
  // The mirror needs a moment to index the contract; its Hedera id comes from there.
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${mirrorUrl}/api/v1/contracts/${address}`).catch(() => null);
    if (res?.ok) {
      const { contract_id } = (await res.json()) as { contract_id: string };
      return { address, contractId: contract_id, txHash };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`deployed at ${address}, but the mirror hasn't shown its Hedera id yet`);
}

/** MandateRegistry: limits, escrow and payouts. */
export const deployRegistry = deployArtifact;
