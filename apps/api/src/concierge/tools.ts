import type Anthropic from "@anthropic-ai/sdk";
import type { Card } from "@app/shared";
import { z } from "zod";
import type { Market } from "./market";

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Each tool: what Claude sees, how its input is checked, and what running it does. */
const FindAgents = z.object({
  skill: z
    .string()
    .regex(/^[a-z0-9_.-]{1,64}$/)
    .optional(),
});
const HotelQuotes = z
  .object({
    iata: z.string().regex(/^[A-Z]{3}$/),
    checkin: Day,
    checkout: Day,
    adults: z.number().int().min(1).max(4),
  })
  .refine((q) => q.checkout > q.checkin, "checkout must be after checkin");

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "find_agents",
    description:
      "List agents on the open market (Arkiv) that can do a kind of job, with their fee. Skills: hotels. Omit skill to list everyone.",
    eager_input_streaming: true,
    input_schema: { type: "object", properties: { skill: { type: "string" } }, required: [] },
  },
  {
    name: "get_hotel_quotes",
    description:
      "Live, firm hotel quotes from the market's hotel agents (free). Each quote is a refundable room with its price locked for 3 minutes, plus the agent's booking fee.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        iata: { type: "string", description: "Nearest airport, e.g. GOI for Goa" },
        checkin: { type: "string", description: "YYYY-MM-DD" },
        checkout: { type: "string", description: "YYYY-MM-DD" },
        adults: { type: "integer", minimum: 1, maximum: 4 },
      },
      required: ["iata", "checkin", "checkout", "adults"],
    },
  },
];

const usdc = (units: string) => (Number(units) / 1e6).toFixed(2);

export interface ToolOutcome {
  result: string; // what Claude reads
  card?: Card; // what the app draws
  isError?: boolean;
}

/** Runs one tool call after validating its input (inputs can arrive truncated when streamed). */
export async function runTool(market: Market, name: string, input: unknown): Promise<ToolOutcome> {
  if (name === "find_agents") {
    const p = FindAgents.safeParse(input);
    if (!p.success) return { result: "invalid input", isError: true };
    const agents = await market.agents(p.data.skill);
    if (agents.length === 0) return { result: "No agents listed for that yet." };
    return {
      result: JSON.stringify(
        agents.map((a) => ({
          name: a.name,
          skill: a.skill,
          fee: `${usdc(a.feeUnits)} USDC`,
          about: a.description,
        })),
      ),
      card: {
        type: "agents",
        skill: p.data.skill ?? "all",
        agents: agents.map((a) => ({
          name: a.name,
          skill: a.skill,
          title: a.name,
          description: a.description,
          priceUnits: a.feeUnits,
          agent: a.agent,
          endpoint: a.endpoint,
        })),
      },
    };
  }
  if (name === "get_hotel_quotes") {
    const p = HotelQuotes.safeParse(input);
    if (!p.success)
      return {
        result: `invalid input: ${p.error.issues[0]?.message ?? "check the fields"}`,
        isError: true,
      };
    const { quotes } = await market.hotelQuotes(p.data);
    if (quotes.length === 0)
      return { result: "No rooms available from the market's hotel agents for those dates." };
    const top = quotes.slice(0, 4);
    return {
      result: JSON.stringify(
        top.map((q) => ({
          quote: q.key,
          agent: q.agent.name,
          hotel: q.hotelName,
          room: q.roomName,
          total: `${q.currency} ${Math.round(q.total)}`,
          refundable: q.refundable ?? null,
          fee: `${usdc(q.feeUnits)} USDC`,
        })),
      ),
      card: {
        type: "quotes",
        skill: "hotels",
        reason: "Cheapest refundable room first",
        quotes: top.map((q) => ({
          key: q.key,
          title: `${q.hotelName} · ${q.agent.name}`,
          note: `${q.roomName}${q.refundable ? ", free cancellation" : ""}`,
          feeUnits: q.feeUnits,
          itemTotal: Math.round(q.total),
          itemCurrency: q.currency,
          reply: `Book ${q.hotelName} (quote ${q.key.slice(0, 10)})`,
        })),
      },
    };
  }
  return { result: `unknown tool ${name}`, isError: true };
}
