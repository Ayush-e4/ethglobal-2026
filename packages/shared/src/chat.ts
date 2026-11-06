import { z } from "zod";

/**
 * What the concierge streams to the app while it answers: text deltas, plus cards the app draws
 * (agents, choices to tap, quotes) instead of parsing prose. Matches the web app's chat screens.
 */
const units = z.string().regex(/^\d+$/); // USDC base units (6 decimals)

/** Agents from the market (Arkiv) that can do what the user asked. */
export const AgentsCardSchema = z.object({
  type: z.literal("agents"),
  skill: z.string(),
  agents: z.array(
    z.object({
      name: z.string(),
      skill: z.string(),
      title: z.string(),
      description: z.string(),
      priceUnits: units,
      agent: z.string(), // EVM address that signs its Arkiv records
      endpoint: z.string(),
      model: z.string().optional(), // how it does the job, e.g. "Book and keep watching"
      delivered: z.number().optional(), // jobs it completed recently (its Arkiv records)
      disputes: z.number().optional(), // of those, how many a buyer reported (on Arkiv, by us)
      rating: z.object({ average: z.number(), count: z.number().int() }).optional(), // verified people
    }),
  ),
});

/** Choices to tap: each sends its `reply` as the user's next message. */
export const OptionsCardSchema = z.object({
  type: z.literal("options"),
  question: z.string(),
  options: z
    .array(z.object({ label: z.string(), detail: z.string().optional(), reply: z.string() }))
    .min(2)
    .max(5),
});

/** Live, firm quotes for one job, best first. Tapping one sends its `reply`. */
export const QuotesCardSchema = z.object({
  type: z.literal("quotes"),
  skill: z.string(),
  reason: z.string(), // why the first one is the default pick
  quotes: z.array(
    z.object({
      key: z.string(), // the quote's Arkiv entity
      title: z.string(),
      note: z.string(),
      feeUnits: units, // the agent's fee
      itemTotal: z.number().optional(), // what the room / ticket costs
      itemCurrency: z.string().optional(),
      reply: z.string(),
      // The offer at a glance (from the agent; images are https only).
      tag: z.string().optional(), // why it's here: "Cheapest", "Best rated"
      images: z.array(z.string().startsWith("https://")).max(4).optional(),
      rating: z
        .object({
          stars: z.number().optional(),
          score: z.number().optional(),
          reviews: z.number().optional(),
        })
        .optional(),
      location: z.string().optional(),
      details: z.array(z.string()).max(6).optional(),
      refundable: z.boolean().optional(),
      model: z.string().optional(), // its agent's way of doing the job
      promise: z.string().optional(), // in the agent's own words
      agentRating: z.object({ average: z.number(), count: z.number().int() }).optional(), // its agent's, by verified people
    }),
  ),
});

/**
 * An agent was hired: its fee is held in escrow. Until `undoUntil` the user can cancel (nothing is
 * paid); after it the agent works, and the app reads the hire's live status by `hireId`.
 */
export const HireCardSchema = z.object({
  type: z.literal("hire"),
  hireId: z.string(),
  title: z.string(),
  feeUnits: units,
  undoUntil: z.string(), // ISO
  payTx: z.string(), // the Hedera transaction that holds the fee
});

/**
 * Before the concierge can pay an agent from the user's own (Face ID) wallet: a spending limit
 * for that agent in this chat, approved with Face ID. Once approved, the app sends `reply` as the
 * user, to carry on with what they asked.
 */
export const LimitCardSchema = z.object({
  type: z.literal("limit"),
  agentName: z.string(),
  payee: z.string().regex(/^0x[0-9a-fA-F]{40}$/), // the one agent it may pay
  budgetUnits: units,
  capUnits: units, // the most for one payment
  hours: z.number().int().positive(),
  reply: z.string(),
});

/**
 * Before a larger payment (see WORLD_CHECK_FEE_USDC): a fresh World ID approval that a real
 * person wants this hire (one payment to this agent, at this fee, in this chat, for 10 minutes:
 * a fresh quote from it is covered). Once approved, the app sends `reply` as the user.
 */
export const HumanCardSchema = z.object({
  type: z.literal("human"),
  agentName: z.string(),
  feeUnits: units,
  quoteKey: z.string(), // the quote that asked: one payment to its agent, at its fee, is approved
  reply: z.string(),
});

/**
 * Before booking: who it's for. The app shows the account's saved travellers (or a form for
 * someone new); their details stay out of the chat and the model. Once chosen, the app sends
 * `reply` as the user, to carry on.
 */
export const TravellerCardSchema = z.object({
  type: z.literal("traveller"),
  agentName: z.string(),
  reply: z.string(),
});

/** Where a reply's facts from the web came from (web search citations), to check them. */
export const SourcesCardSchema = z.object({
  type: z.literal("sources"),
  sources: z.array(z.object({ title: z.string(), url: z.string().startsWith("https://") })).max(8),
});

export const CardSchema = z.discriminatedUnion("type", [
  AgentsCardSchema,
  OptionsCardSchema,
  QuotesCardSchema,
  HireCardSchema,
  LimitCardSchema,
  HumanCardSchema,
  TravellerCardSchema,
  SourcesCardSchema,
]);
export type Card = z.infer<typeof CardSchema>;

export const ConciergeEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), delta: z.string() }),
  z.object({ type: z.literal("card"), card: CardSchema }),
  z.object({ type: z.literal("status"), label: z.string() }), // e.g. "Looking at the market"
  z.object({ type: z.literal("done"), messageId: z.string() }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ConciergeEvent = z.infer<typeof ConciergeEventSchema>;

export const SendMessageSchema = z.object({ text: z.string().trim().min(1).max(4000) });
