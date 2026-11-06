import { str } from "@arkiv-network/sdk/schema";
import type { Hex } from "viem";
import {
  type Agent,
  AgentSchema,
  type Delivery,
  DeliverySchema,
  type JOB_STATUS,
  type Job,
  JobSchema,
  type Listing,
  ListingSchema,
  type Quote,
  QuoteSchema,
  type Rating,
  RatingSchema,
  type Receipt,
  ReceiptSchema,
} from "./records";
import type { SafeArkivWriter } from "./safe-writer";
import { LIFETIME, SCHEMAS, valuesFor } from "./schemas";

const self = (w: SafeArkivWriter, who: string, what: string) => {
  if (who.toLowerCase() !== w.address.toLowerCase())
    throw new Error(`${what}: only its own records`);
};

/** An agent publishes its profile and listings in one atomic transaction. */
export async function publishAgent(w: SafeArkivWriter, agent: Agent, listings: Listing[]) {
  const a = AgentSchema.parse(agent);
  const ls = listings.map((l) => ListingSchema.parse(l));
  for (const x of [a, ...ls]) self(w, x.agent, "publishAgent");
  const r = await w.run(1 + ls.length, (tx) =>
    w.client.executeBatch(
      {
        creates: [
          { schema: SCHEMAS.agent, values: valuesFor("agent", a), expiration: LIFETIME.agent() },
          ...ls.map((l) => ({
            schema: SCHEMAS.listing,
            values: valuesFor("listing", l),
            expiration: LIFETIME.listing(),
          })),
        ] as never,
      },
      tx,
    ),
  );
  const [profile, ...listingKeys] = r.createdEntities;
  return { profile: profile as Hex, listings: listingKeys, txHash: r.txHash };
}

/** New listings for an agent already on the market (say, with a new form); the newest counts. */
export async function publishListings(w: SafeArkivWriter, listings: Listing[]) {
  const ls = listings.map((l) => ListingSchema.parse(l));
  for (const l of ls) self(w, l.agent, "publishListings");
  const r = await w.run(ls.length, (tx) =>
    w.client.executeBatch(
      {
        creates: ls.map((l) => ({
          schema: SCHEMAS.listing,
          values: valuesFor("listing", l),
          expiration: LIFETIME.listing(),
        })) as never,
      },
      tx,
    ),
  );
  return { listings: r.createdEntities as Hex[], txHash: r.txHash };
}

/** Several quotes for one task in one transaction; they all vanish after `ttlSeconds`. */
export async function postQuotes(w: SafeArkivWriter, quotes: Quote[], ttlSeconds = 180) {
  const qs = quotes.map((q) => QuoteSchema.parse(q));
  for (const q of qs) self(w, q.agent, "postQuotes");
  const r = await w.run(qs.length, (tx) =>
    w.client.executeBatch(
      {
        creates: qs.map((q) => ({
          schema: SCHEMAS.quote,
          values: valuesFor("quote", q),
          expiration: LIFETIME.quote(ttlSeconds),
        })) as never,
      },
      tx,
    ),
  );
  return { keys: r.createdEntities as Hex[], txHash: r.txHash };
}

/** An agent quotes a task; the quote vanishes from every query after `ttlSeconds`. */
export function postQuote(w: SafeArkivWriter, quote: Quote, ttlSeconds = 180) {
  const q = QuoteSchema.parse(quote);
  self(w, q.agent, "postQuote");
  return w.run(1, (tx) =>
    w.client.createEntity(
      SCHEMAS.quote,
      valuesFor("quote", q),
      { expiration: LIFETIME.quote(ttlSeconds) },
      tx,
    ),
  );
}

/** The buyer records a hire. */
export function openJob(w: SafeArkivWriter, job: Job) {
  const j = JobSchema.parse(job);
  self(w, j.buyer, "openJob");
  return w.run(1, (tx) =>
    w.client.createEntity(SCHEMAS.job, valuesFor("job", j), { expiration: LIFETIME.job() }, tx),
  );
}

/** The buyer moves a job on (only the entity's owner can patch it). */
export function setJobStatus(w: SafeArkivWriter, jobKey: Hex, status: (typeof JOB_STATUS)[number]) {
  return w.run(1, (tx) =>
    w.client.patchEntity(SCHEMAS.job, jobKey, { set: { status: str(status) } } as never, tx),
  );
}

/** The platform's receipt for a paid job: pointers to the Hedera transaction and log entry. */
export function recordReceipt(w: SafeArkivWriter, receipt: Receipt) {
  const r = ReceiptSchema.parse(receipt);
  return w.run(1, (tx) =>
    w.client.createEntity(
      SCHEMAS.receipt,
      valuesFor("receipt", r),
      { expiration: LIFETIME.receipt() },
      tx,
    ),
  );
}

/** The agent's own record that it delivered (or refunded). */
export function recordDelivery(w: SafeArkivWriter, delivery: Delivery) {
  const d = DeliverySchema.parse(delivery);
  self(w, d.agent, "recordDelivery");
  return w.run(1, (tx) =>
    w.client.createEntity(
      SCHEMAS.delivery,
      valuesFor("delivery", d),
      { expiration: LIFETIME.delivery() },
      tx,
    ),
  );
}

/** The buyer rates the agent after a job. */
export function rateAgent(w: SafeArkivWriter, rating: Rating) {
  const r = RatingSchema.parse(rating);
  self(w, r.rater, "rateAgent");
  return w.run(1, (tx) =>
    w.client.createEntity(
      SCHEMAS.rating,
      valuesFor("rating", r),
      { expiration: LIFETIME.rating() },
      tx,
    ),
  );
}
