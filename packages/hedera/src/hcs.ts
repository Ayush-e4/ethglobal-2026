import {
  type Client,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
} from "@hiero-ledger/sdk";

/**
 * Hedera Consensus Service: a public, append-only, timestamped log (like a Kafka topic nobody
 * can edit). The topic gets **no admin key**, so nobody, us included, can delete or change it.
 * Only the writer (the submit key `writerKey` belongs to) may write; anyone can read through the mirror node.
 */
export async function createTopic(
  client: Client,
  opts: { memo: string; writerKey: string },
): Promise<{ topicId: string; transactionId: string }> {
  const res = await new TopicCreateTransaction()
    .setTopicMemo(opts.memo)
    .setSubmitKey(PrivateKey.fromStringECDSA(opts.writerKey).publicKey)
    .execute(client);
  const receipt = await res.getReceipt(client);
  if (!receipt.topicId) throw new Error("Hedera created no topic");
  return { topicId: receipt.topicId.toString(), transactionId: res.transactionId.toString() };
}

/** Appends one message, signed by the writer's key. Returns its number in the log (1, 2, 3…). */
export async function submitMessage(
  client: Client,
  opts: { topicId: string; message: string | object; writerKey: string },
): Promise<{ sequence: number; transactionId: string }> {
  const body = typeof opts.message === "string" ? opts.message : JSON.stringify(opts.message);
  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(opts.topicId)
    .setMessage(body)
    .freezeWith(client)
    .sign(PrivateKey.fromStringECDSA(opts.writerKey));
  const res = await tx.execute(client);
  const receipt = await res.getReceipt(client);
  return {
    sequence: Number(receipt.topicSequenceNumber ?? 0),
    transactionId: res.transactionId.toString(),
  };
}
