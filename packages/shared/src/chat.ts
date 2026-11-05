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
    }),
  ),
});

export const CardSchema = z.discriminatedUnion("type", [
  AgentsCardSchema,
  OptionsCardSchema,
  QuotesCardSchema,
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
