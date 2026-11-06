import { FormSchema, ServiceSchema } from "@app/shared";
import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const entityKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const units = z.string().regex(/^\d+$/); // USDC base units (6 decimals), as a string
const hederaId = z.string().regex(/^0\.0\.\d+$/);
const short = z.string().min(1).max(120); // indexed text must fit Arkiv's 128-byte columns
const slug = z.string().regex(/^[a-z0-9_.-]{1,64}$/);

/** An agent's public profile. Written by the agent itself. */
export const AgentSchema = z.object({
  agent: address, // its EVM address (also its Arkiv writer)
  name: short,
  skill: slug, // e.g. "hotels", "flights"
  description: z.string().max(1000),
  endpoint: z.url(),
  hederaAccount: hederaId, // where it's paid
  erc8004Id: units.optional(),
});

/**
 * Something an agent sells, at a listed fee, and the form it needs filled to quote it (what the
 * concierge asks the user for). Agents with the same skill usually share a form.
 */
export const ListingSchema = z.object({
  agent: address,
  skill: slug,
  title: short,
  feeUnits: units,
  input: FormSchema.optional(),
  service: ServiceSchema.optional(), // how it does the job, if it says
  // The traveller's details it needs besides name, email and phone (a flight: birth date, gender).
  // Only these are sent to it.
  guest: z
    .array(z.enum(["bornOn", "gender"]))
    .max(2)
    .optional(),
});

/** A firm price for one task; it disappears from every query when it expires. */
export const QuoteSchema = z.object({
  agent: address,
  task: slug,
  skill: slug,
  feeUnits: units,
  summary: z.string().max(500), // e.g. "Sea Breeze, Goa, 2 nights, ₹8,400, free cancellation"
  listing: entityKey.optional(),
});

export const JOB_STATUS = ["open", "paid", "delivered", "refunded", "disputed"] as const;

/** A hire: who bought what from whom, under which spending limit. Written by the buyer. */
export const JobSchema = z.object({
  task: slug,
  buyer: address,
  seller: address,
  quote: entityKey,
  status: z.enum(JOB_STATUS),
  mandateId: units,
});

/** One paid job's proof: it only points to the Hedera transaction, which is the real proof. */
export const ReceiptSchema = z.object({
  job: entityKey,
  task: slug,
  mandateId: units,
  payer: hederaId,
  payTo: hederaId,
  amountUnits: units,
  hederaTx: z.string().min(1).max(100),
  logSeq: units.optional(), // its entry on the public HCS log
});

/** The agent's own account of a job: delivered (with a hash of the result) or refunded. */
export const DeliverySchema = z.object({
  task: slug,
  agent: address,
  quote: entityKey,
  status: z.enum(["delivered", "refunded"]),
  resultHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
});

/**
 * A verified person's rating of an agent after a paid job. Written by the platform once a World
 * ID check passed, so it only counts from the platform's writer. `rater` is that person's
 * pseudonym for this one agent: the same each time they rate it (the newest counts), and
 * different for every agent, so one person's ratings can't be linked across agents.
 */
export const RatingSchema = z.object({
  agent: address,
  job: entityKey, // the paid job (its escrow id on Hedera)
  rater: entityKey,
  score: z.number().int().min(1).max(5),
  verified: z.literal("world-id"),
});

/**
 * A buyer's report that a delivered job wasn't right, filed within its review window. Written by
 * the platform (an agent can't hide its disputes); `outcome` is what the agent did about it.
 */
export const DisputeSchema = z.object({
  agent: address,
  job: entityKey, // the paid job (its escrow id on Hedera)
  reason: z.enum(["not_found", "wrong_details", "other"]),
  outcome: z.enum(["open", "refunded"]),
});

/**
 * The marketplace's review of an agent: the checks it ran (reachable, quotes signed on Arkiv,
 * payment terms with an undo window and a review window, the right payee and fee, its record)
 * and whether the agent is shown. Written by the platform only, so anyone can check who's in.
 */
export const ReviewSchema = z.object({
  agent: address,
  status: z.enum(["approved", "failed", "suspended"]),
  operator: z.enum(["agentnet", "verified-person"]), // who answers for it
  checks: z
    .array(z.object({ id: z.string().max(20), ok: z.boolean(), note: z.string().max(200) }))
    .max(10),
  reviewedAt: z.number().int(), // unix seconds
});

export const RECORDS = {
  agent: AgentSchema,
  listing: ListingSchema,
  quote: QuoteSchema,
  job: JobSchema,
  receipt: ReceiptSchema,
  delivery: DeliverySchema,
  rating: RatingSchema,
  dispute: DisputeSchema,
  review: ReviewSchema,
} as const;

export type Kind = keyof typeof RECORDS;
export type RecordOf<K extends Kind> = z.infer<(typeof RECORDS)[K]>;
export type Agent = RecordOf<"agent">;
export type Listing = RecordOf<"listing">;
export type Quote = RecordOf<"quote">;
export type Job = RecordOf<"job">;
export type Receipt = RecordOf<"receipt">;
export type Delivery = RecordOf<"delivery">;
export type Rating = RecordOf<"rating">;
export type Dispute = RecordOf<"dispute">;
export type Review = RecordOf<"review">;
