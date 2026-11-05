import { ExpirationTime } from "@arkiv-network/sdk";
import { addr, bytes, defineSchema, i32, key, str, u64 } from "@arkiv-network/sdk/schema";
import { stringToBytes } from "viem";
import { PROJECT } from "./config";
import type { Kind, RecordOf } from "./records";

/**
 * One named schema per kind (`ethglobal-2026.quote`, …): the name tags every entity, so our
 * queries never match other apps' data. Only the columns we filter on are indexed; `body` holds
 * the whole record as JSON (stored and selectable, never filtered).
 */
const named = (kind: Kind) => `${PROJECT}.${kind}`;
const body = bytes();

export const SCHEMAS = {
  agent: defineSchema(named("agent"), {
    agent: addr().indexed(),
    skill: str().indexed(),
    body,
  }),
  listing: defineSchema(named("listing"), {
    agent: addr().indexed(),
    skill: str().indexed(),
    fee_units: u64().indexed(),
    body,
  }),
  quote: defineSchema(named("quote"), {
    agent: addr().indexed(),
    task: str().indexed(),
    skill: str().indexed(),
    fee_units: u64().indexed(),
    body,
  }),
  job: defineSchema(named("job"), {
    task: str().indexed(),
    buyer: addr().indexed(),
    seller: addr().indexed(),
    status: str().indexed(),
    body,
  }),
  receipt: defineSchema(named("receipt"), {
    job: key().indexed(),
    task: str().indexed(),
    pay_to: str().indexed(),
    body,
  }),
  delivery: defineSchema(named("delivery"), {
    task: str().indexed(),
    agent: addr().indexed(),
    status: str().indexed(),
    body,
  }),
  rating: defineSchema(named("rating"), {
    agent: addr().indexed(),
    job: key().indexed(),
    rater: addr().indexed(),
    score: i32().indexed(),
    body,
  }),
} as const;

/** How long each kind lives. Rabdi caps lifetimes at ~182 days; blocks are 2 s. */
export const LIFETIME = {
  agent: () => ExpirationTime.fromDays(30),
  listing: () => ExpirationTime.fromDays(30),
  quote: (seconds = 180) => ExpirationTime.fromSeconds(seconds - (seconds % 2)),
  job: () => ExpirationTime.fromDays(7),
  receipt: () => ExpirationTime.fromDays(90),
  delivery: () => ExpirationTime.fromDays(90),
  rating: () => ExpirationTime.fromDays(180),
} as const;

const asBody = (record: object) => stringToBytes(JSON.stringify(record));

/** The typed column values for a record (indexed columns + the JSON body). */
export function valuesFor<K extends Kind>(kind: K, record: RecordOf<K>): never {
  const r = record as RecordOf<Kind>;
  let cols: Record<string, unknown>;
  switch (kind) {
    case "agent": {
      const x = r as RecordOf<"agent">;
      cols = { agent: addr(x.agent), skill: str(x.skill) };
      break;
    }
    case "listing": {
      const x = r as RecordOf<"listing">;
      cols = { agent: addr(x.agent), skill: str(x.skill), fee_units: u64(BigInt(x.feeUnits)) };
      break;
    }
    case "quote": {
      const x = r as RecordOf<"quote">;
      cols = {
        agent: addr(x.agent),
        task: str(x.task),
        skill: str(x.skill),
        fee_units: u64(BigInt(x.feeUnits)),
      };
      break;
    }
    case "job": {
      const x = r as RecordOf<"job">;
      cols = {
        task: str(x.task),
        buyer: addr(x.buyer),
        seller: addr(x.seller),
        status: str(x.status),
      };
      break;
    }
    case "receipt": {
      const x = r as RecordOf<"receipt">;
      cols = { job: key(x.job as `0x${string}`), task: str(x.task), pay_to: str(x.payTo) };
      break;
    }
    case "delivery": {
      const x = r as RecordOf<"delivery">;
      cols = { task: str(x.task), agent: addr(x.agent), status: str(x.status) };
      break;
    }
    default: {
      const x = r as RecordOf<"rating">;
      cols = {
        agent: addr(x.agent),
        job: key(x.job as `0x${string}`),
        rater: addr(x.rater),
        score: i32(x.score),
      };
    }
  }
  // Each schema types its own values; ours are built per kind above, so widen here.
  return { ...cols, body: bytes(asBody(record)) } as never;
}
