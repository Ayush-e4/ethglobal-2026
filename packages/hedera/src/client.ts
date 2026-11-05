import { AccountId, Client, PrivateKey } from "@hiero-ledger/sdk";
import { type Account, type HederaNetwork, NETWORKS } from "./config";

/** A Hedera client that signs and pays as `payer`. Each role gets its own client. */
export function createClient(network: HederaNetwork, payer: Account): Client {
  const client = network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(AccountId.fromString(payer.id), PrivateKey.fromStringECDSA(payer.key));
  return client;
}

/** Public receipt links anyone can open. */
export const hashscan = (network: HederaNetwork) => {
  const base = NETWORKS[network].hashscanUrl;
  return {
    tx: (transactionId: string) => `${base}/transaction/${transactionId}`,
    account: (accountId: string) => `${base}/account/${accountId}`,
    topic: (topicId: string) => `${base}/topic/${topicId}`,
  };
};
