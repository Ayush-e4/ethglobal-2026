import {
  AccountCreateTransaction,
  type Client,
  Hbar,
  PrivateKey,
  TokenAssociateTransaction,
} from "@hiero-ledger/sdk";

export interface NewAccount {
  id: string;
  evmAddress: string;
  /** Raw hex ECDSA key. Goes straight into .env; never print it. */
  key: string;
  transactionId: string;
}

/**
 * A new account with a fresh ECDSA key. With the key as its alias it also has a normal EVM
 * address (0x…), so the same key signs Hedera transactions and EVM messages. The client's
 * operator pays and funds the starting HBAR.
 */
export async function createAccount(
  client: Client,
  opts: { initialHbar: number; memo: string; autoAssociations?: number },
): Promise<NewAccount> {
  const key = PrivateKey.generateECDSA();
  const res = await new AccountCreateTransaction()
    .setECDSAKeyWithAlias(key)
    .setInitialBalance(new Hbar(opts.initialHbar))
    .setMaxAutomaticTokenAssociations(opts.autoAssociations ?? 10)
    .setAccountMemo(opts.memo)
    .execute(client);
  const receipt = await res.getReceipt(client);
  if (!receipt.accountId) throw new Error("Hedera created no account");
  return {
    id: receipt.accountId.toString(),
    evmAddress: `0x${key.publicKey.toEvmAddress()}`,
    key: key.toStringRaw(),
    transactionId: res.transactionId.toString(),
  };
}

/** Opts an account in to holding a token (like enabling a currency on a card). Once per token. */
export async function associateToken(
  client: Client,
  account: { id: string; key: string },
  tokenId: string,
): Promise<string> {
  const tx = await new TokenAssociateTransaction()
    .setAccountId(account.id)
    .setTokenIds([tokenId])
    .freezeWith(client)
    .sign(PrivateKey.fromStringECDSA(account.key));
  const res = await tx.execute(client);
  await res.getReceipt(client);
  return res.transactionId.toString();
}
