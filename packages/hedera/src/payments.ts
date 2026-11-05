import { type Client, Hbar, PrivateKey, TransferTransaction } from "@hiero-ledger/sdk";

/**
 * Moves `units` of a token (USDC: 1 USDC = 1_000_000 units) in one atomic transaction: both
 * sides change or neither does. `fromKey` signs when `from` isn't the client's own account.
 */
export async function transferToken(
  client: Client,
  t: { tokenId: string; from: string; to: string; units: bigint; fromKey?: string; memo?: string },
): Promise<string> {
  if (t.units <= BigInt(0)) throw new Error("Transfer amount must be positive");
  if (t.units > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Transfer amount too large");
  const amount = Number(t.units);
  let tx = new TransferTransaction()
    .addTokenTransfer(t.tokenId, t.from, -amount)
    .addTokenTransfer(t.tokenId, t.to, amount)
    .setTransactionMemo(t.memo ?? "")
    .freezeWith(client);
  if (t.fromKey) tx = await tx.sign(PrivateKey.fromStringECDSA(t.fromKey));
  const res = await tx.execute(client);
  await res.getReceipt(client);
  return res.transactionId.toString();
}

/** Sends HBAR (network-fee money) from the client's own account. */
export async function transferHbar(
  client: Client,
  t: { from: string; to: string; hbar: number; memo?: string },
): Promise<string> {
  if (!(t.hbar > 0)) throw new Error("Transfer amount must be positive");
  const res = await new TransferTransaction()
    .addHbarTransfer(t.from, new Hbar(-t.hbar))
    .addHbarTransfer(t.to, new Hbar(t.hbar))
    .setTransactionMemo(t.memo ?? "")
    .execute(client);
  await res.getReceipt(client);
  return res.transactionId.toString();
}
