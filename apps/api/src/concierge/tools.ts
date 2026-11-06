import type Anthropic from "@anthropic-ai/sdk";
import type { Card } from "@app/shared";
import { z } from "zod";
import type { User } from "../db/schema";
import { NeedsLimit } from "../hiring/limits";
import type { HotelQuote, Market } from "./market";

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

const BookQuote = z.object({ quote: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });

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
  {
    name: "book_quote",
    description:
      "Book a quote shown in this chat, when the user has clearly said which one. Pays the agent's fee from the chat's spending limit into escrow; the user has a short window to undo, then the agent books it. Never call it without the user choosing.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        quote: { type: "string", description: "The quote's key (0x…) from get_hotel_quotes" },
      },
      required: ["quote"],
    },
  },
];

/** What the tools can reach, and whose chat this is. */
export interface ToolDeps {
  market: Market;
  saveQuotes: (chatId: string, quotes: HotelQuote[]) => Promise<void>;
  hire: (
    user: User,
    chatId: string,
    quoteKey: string,
  ) => Promise<{
    id: string;
    title: string;
    feeUnits: bigint;
    undoUntil: Date | null;
    payTx: string | null;
  }>;
}
export interface ToolContext {
  user: User;
  chatId: string;
}

const usdc = (units: string) => (Number(units) / 1e6).toFixed(2);

export interface ToolOutcome {
  result: string; // what Claude reads
  card?: Card; // what the app draws
  isError?: boolean;
}

/** Runs one tool call after validating its input (inputs can arrive truncated when streamed). */
export async function runTool(
  deps: ToolDeps,
  ctx: ToolContext,
  name: string,
  input: unknown,
): Promise<ToolOutcome> {
  const { market } = deps;
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
    await deps.saveQuotes(ctx.chatId, top); // only quotes shown in this chat can be booked from it
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
  if (name === "book_quote") {
    const p = BookQuote.safeParse(input);
    if (!p.success) return { result: "invalid input: give the quote's 0x key", isError: true };
    try {
      const h = await deps.hire(ctx.user, ctx.chatId, p.data.quote);
      const undo = h.undoUntil ?? new Date();
      return {
        result: `The agent is hired to book it, but it is NOT booked yet: its ${usdc(h.feeUnits.toString())} USDC fee is held in escrow, and the user can undo with the card's Undo button until ${undo.toISOString()} (the card counts down). After that the agent books it and the chat gets the booking reference. Say this plainly; don't call it booked.`,
        card: {
          type: "hire",
          hireId: h.id,
          title: h.title,
          feeUnits: h.feeUnits.toString(),
          undoUntil: undo.toISOString(),
          payTx: h.payTx ?? "",
        },
      };
    } catch (err) {
      if (err instanceof NeedsLimit)
        return {
          result: `Not booked yet: ${err.card.agentName} is paid from the user's own wallet, so they first approve a spending limit for it with Face ID (the card shows it: up to ${usdc(err.card.budgetUnits)} USDC in this chat for ${err.card.hours} hours). Ask them to approve it on the card; once they do, the app sends the booking again. Don't call book_quote again until then.`,
          card: err.card,
        };
      return {
        result: err instanceof Error ? err.message : "The booking failed. Nothing was charged.",
        isError: true,
      };
    }
  }
  return { result: `unknown tool ${name}`, isError: true };
}
