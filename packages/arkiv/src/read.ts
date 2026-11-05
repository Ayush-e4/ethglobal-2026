import { and, eq, lte } from "@arkiv-network/sdk/query";
import { addr, key, str, u64 } from "@arkiv-network/sdk/schema";
import { type Hex, hexToBytes, isHex } from "viem";
import type { ArkivReader } from "./config";
import { type Kind, RECORDS, type RecordOf } from "./records";
import { SCHEMAS } from "./schemas";

/** A record as read back: validated, with who wrote it and when it expires (in blocks). */
export interface Found<T> {
  key: Hex;
  creator: Hex;
  expiresAt: bigint;
  record: T;
}

/**
 * Anyone can write an entity under our schema names, so a record only counts if the network says
 * it was written by the party it claims to be from ($creator). Receipts only count from our own
 * writer (pass `trustedWriter`).
 */
const AUTHOR: Record<Kind, (r: Record<string, unknown>) => string | null> = {
  agent: (r) => r.agent as string,
  listing: (r) => r.agent as string,
  quote: (r) => r.agent as string,
  job: (r) => r.buyer as string,
  receipt: () => null, // checked against the trusted writer instead
  delivery: (r) => r.agent as string,
  rating: (r) => r.rater as string,
};

/** Decodes one row; null if the body is invalid or the author doesn't match. */
export function decodeRow<K extends Kind>(
  kind: K,
  row: { $key: Hex; $creator: Hex; $expiresAt: bigint; body: unknown },
  trustedWriter?: Hex,
): Found<RecordOf<K>> | null {
  const raw = (row.body as { value?: unknown } | undefined)?.value ?? row.body;
  const bytes = raw instanceof Uint8Array ? raw : isHex(raw) ? hexToBytes(raw) : null;
  if (!bytes) return null;
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  const parsed = RECORDS[kind].safeParse(json);
  if (!parsed.success) return null;
  const creator = row.$creator.toLowerCase();
  const author = AUTHOR[kind](parsed.data as Record<string, unknown>);
  if (author !== null && author.toLowerCase() !== creator) return null;
  if (kind === "receipt" && creator !== trustedWriter?.toLowerCase()) return null;
  return {
    key: row.$key,
    creator: row.$creator,
    expiresAt: BigInt(row.$expiresAt),
    record: parsed.data as RecordOf<K>,
  };
}

type Filter = ReturnType<typeof eq>;
type Builder = {
  where(e: unknown): Builder;
  createdBy(a: Hex): Builder;
  limit(n: number): Builder;
  fetch(): Promise<{ entities: Record<string, unknown>[] }>;
};

async function find<K extends Kind>(
  r: ArkivReader,
  kind: K,
  filters: Filter[],
  opts: { createdBy?: Hex; trustedWriter?: Hex; limit?: number } = {},
) {
  let q = r
    .select({ $key: true, $creator: true, $expiresAt: true, body: true })
    .from(SCHEMAS[kind] as never) as unknown as Builder;
  if (filters.length) q = q.where(filters.length === 1 ? filters[0] : and(...filters));
  if (opts.createdBy) q = q.createdBy(opts.createdBy);
  const page = await q.limit(opts.limit ?? 100).fetch();
  return page.entities
    .map((e) => decodeRow(kind, e as never, opts.trustedWriter))
    .filter((d): d is Found<RecordOf<K>> => d !== null);
}

export const findAgents = (r: ArkivReader, skill?: string) =>
  find(r, "agent", skill ? [eq("skill", str(skill))] : []);

export const findListings = (r: ArkivReader, skill: string, maxFeeUnits?: bigint) =>
  find(r, "listing", [
    eq("skill", str(skill)),
    ...(maxFeeUnits !== undefined ? [lte("fee_units", u64(maxFeeUnits))] : []),
  ]);

/** Quotes for a task that haven't expired, cheapest first. */
export async function liveQuotes(r: ArkivReader, task: string) {
  const quotes = await find(r, "quote", [eq("task", str(task))]);
  return quotes.sort((a, b) => Number(BigInt(a.record.feeUnits) - BigInt(b.record.feeUnits)));
}

export const jobsForTask = (r: ArkivReader, task: string) =>
  find(r, "job", [eq("task", str(task))]);

export const receiptsForJob = (r: ArkivReader, job: Hex, platform: Hex) =>
  find(r, "receipt", [eq("job", key(job))], { createdBy: platform, trustedWriter: platform });

export const deliveriesBy = (r: ArkivReader, agent: Hex) =>
  find(r, "delivery", [eq("agent", addr(agent))], { createdBy: agent });

/** An agent's ratings: one per job per rater (the first counts), with the average. */
export async function ratingsFor(r: ArkivReader, agent: Hex) {
  const all = await find(r, "rating", [eq("agent", addr(agent))]);
  const seen = new Set<string>();
  const ratings = all.filter((x) => {
    const id = `${x.record.job}|${x.record.rater.toLowerCase()}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const average = ratings.length
    ? ratings.reduce((s, x) => s + x.record.score, 0) / ratings.length
    : null;
  return { ratings, average };
}
