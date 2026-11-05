import { z } from "zod";

/**
 * Read-only queries through the mirror node's REST API (a public read replica of Hedera).
 * It lags consensus by a few seconds, so callers that just wrote something poll briefly.
 */

const AccountSchema = z.object({
  account: z.string(),
  evm_address: z.string().nullable().optional(),
  balance: z.object({
    balance: z.number(),
    tokens: z.array(z.object({ token_id: z.string(), balance: z.number() })),
  }),
});

export interface AccountBalances {
  id: string;
  evmAddress?: string;
  tinybars: bigint;
  tokens: Record<string, bigint>;
}

export function parseAccount(json: unknown): AccountBalances {
  const a = AccountSchema.parse(json);
  return {
    id: a.account,
    evmAddress: a.evm_address ?? undefined,
    tinybars: BigInt(a.balance.balance),
    tokens: Object.fromEntries(a.balance.tokens.map((t) => [t.token_id, BigInt(t.balance)])),
  };
}

const KeySchema = z.object({ _type: z.string(), key: z.string() }).nullable();
const TopicSchema = z.object({
  topic_id: z.string(),
  memo: z.string(),
  admin_key: KeySchema,
  submit_key: KeySchema,
});

export interface TopicInfo {
  id: string;
  memo: string;
  /** Hex public key that may change or delete the topic, or null: nobody can. */
  adminKey: string | null;
  /** Hex public key that may write, or null: anyone can. */
  submitKey: string | null;
}

export function parseTopic(json: unknown): TopicInfo {
  const t = TopicSchema.parse(json);
  return {
    id: t.topic_id,
    memo: t.memo,
    adminKey: t.admin_key?.key ?? null,
    submitKey: t.submit_key?.key ?? null,
  };
}

const MessagesSchema = z.object({
  messages: z.array(
    z.object({ sequence_number: z.number(), consensus_timestamp: z.string(), message: z.string() }),
  ),
});

export interface TopicMessage {
  sequence: number;
  timestamp: string;
  text: string;
}

export function parseMessages(json: unknown): TopicMessage[] {
  return MessagesSchema.parse(json).messages.map((m) => ({
    sequence: m.sequence_number,
    timestamp: m.consensus_timestamp,
    text: Buffer.from(m.message, "base64").toString("utf8"),
  }));
}

export class Mirror {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async get(path: string): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/v1${path}`);
    if (!res.ok) throw new Error(`mirror ${path}: HTTP ${res.status}`);
    return res.json();
  }

  /** An account's balances, or null if it doesn't exist (yet). */
  async balances(accountIdOrEvm: string): Promise<AccountBalances | null> {
    try {
      return parseAccount(await this.get(`/accounts/${accountIdOrEvm}`));
    } catch (e) {
      if (e instanceof Error && e.message.endsWith("HTTP 404")) return null;
      throw e;
    }
  }

  async topic(topicId: string): Promise<TopicInfo> {
    return parseTopic(await this.get(`/topics/${topicId}`));
  }

  /** Newest first. */
  async topicMessages(topicId: string, limit = 10): Promise<TopicMessage[]> {
    return parseMessages(await this.get(`/topics/${topicId}/messages?order=desc&limit=${limit}`));
  }
}
