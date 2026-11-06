import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { NeedsLimit } from "../hiring/limits";
import { NeedsTraveller } from "../travellers/service";
import { NeedsHuman } from "../world/checkpoint";
import { ASK_AGENT, askAgent } from "./lookup-tool";
import type { ToolContext, ToolDeps, ToolOutcome } from "./tool-types";

export type { ToolContext, ToolDeps, ToolOutcome } from "./tool-types";

const Skill = z.string().regex(/^[a-z0-9_.-]{1,64}$/);
const FindAgents = z.object({ need: z.string().max(300).optional(), skill: Skill.optional() });
const AgentInput = z.object({ skill: Skill });
const GetQuotes = z.object({ skill: Skill, input: z.record(z.string(), z.unknown()) });
const Hire = z.object({ quote: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });

/**
 * The market, in five generic tools: who does a job, what they need to know, firm offers from
 * all of them, hiring one, and asking a lookup agent. A new agent needs no new tool: it
 * publishes its form.
 */
export const TOOLS: Anthropic.Beta.Messages.BetaTool[] = [
  {
    name: "find_agents",
    description:
      "Search the open market (Arkiv) for agents that can do a job, by what the user needs in plain words, or list one skill's agents. Returns each agent's skill, fee, how it does the job (its service model and promise, in its own words) how many jobs it has delivered and how many of those a buyer reported a problem with, and its rating by verified people (World ID, on Arkiv; one per person). Use it to learn which skill to quote, and to explain the agents' different ways of working.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        need: { type: "string", description: "What the user wants done, in plain words" },
        skill: { type: "string", description: "A skill name, if you know it" },
      },
      required: [],
    },
  },
  {
    name: "agent_input",
    description:
      "The form agents with this skill need filled to quote a job: each field, its type and what it means. Read it before get_quotes, and ask the user for anything required that you don't know yet.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { skill: { type: "string" } },
      required: ["skill"],
    },
  },
  {
    name: "get_quotes",
    description:
      "Firm, live offers (free) from every agent with this skill, ranked cheapest first. `input` is the form from agent_input, filled in. Each offer's price is locked for about 3 minutes and has the agent's booking fee.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        skill: { type: "string" },
        input: { type: "object", description: "The form's fields, filled in" },
      },
      required: ["skill", "input"],
    },
  },
  {
    name: "hire",
    description:
      "Hire the agent for an offer shown in this chat, once the user has clearly chosen it. Pays the agent's fee from the user's spending limit into escrow; the user has a short window to undo, then the agent does the job. Never call it without the user choosing.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        quote: { type: "string", description: "The offer's key (0x…) from get_quotes" },
      },
      required: ["quote"],
    },
  },
  ASK_AGENT,
];

const usdc = (units: string) => (Number(units) / 1e6).toFixed(2);

const invalid = (what: string): ToolOutcome => ({
  result: `invalid input: ${what}`,
  isError: true,
});

/** Runs one tool call after validating its input (inputs can arrive truncated when streamed). */
/** An agent's rating by verified people, for Claude to read. */
const rated = (r?: { average: number; count: number }) =>
  r
    ? `${r.average.toFixed(1)}/5 from ${r.count} verified ${r.count === 1 ? "person" : "people"}`
    : "no verified ratings yet";

export async function runTool(
  deps: ToolDeps,
  ctx: ToolContext,
  name: string,
  input: unknown,
): Promise<ToolOutcome> {
  const { market } = deps;
  if (name === "find_agents") {
    const p = FindAgents.safeParse(input);
    if (!p.success) return invalid("need is plain words; skill is a short name");
    const found = p.data.skill
      ? {
          agents: (await market.agents(p.data.skill)).filter((a) => a.form),
          matched: true,
          total: 0,
        }
      : await market.search(p.data.need);
    const agents = found.agents;
    if (agents.length === 0) return { result: "No agents on the market can do that yet." };
    const lead = found.matched
      ? ""
      : "Nothing matched that need; here is the market, most reliable first. ";
    return {
      result:
        lead +
        JSON.stringify(
          agents.map((a) => ({
            name: a.name,
            skill: a.skill,
            kind: a.kind,
            fee:
              a.kind === "lookup"
                ? `${(Number(a.feeUnits) / 1e6).toFixed(3)} USDC per lookup`
                : `${usdc(a.feeUnits)} USDC`,
            model: a.service?.model,
            promise: a.service?.promise,
            afterwards: a.service?.afterwards,
            delivered: a.delivered,
            reportedProblems: a.disputes ?? 0,
            verifiedRating: rated(a.rating),
            about: a.description,
          })),
        ),
      card: {
        type: "agents",
        skill:
          p.data.skill ??
          (new Set(agents.map((a) => a.skill)).size === 1 ? (agents[0]?.skill ?? "all") : "all"),
        agents: agents.map((a) => ({
          name: a.name,
          skill: a.skill,
          title: a.name,
          description: a.service?.promise ?? a.description,
          priceUnits: a.feeUnits,
          agent: a.agent,
          endpoint: a.endpoint,
          model: a.service?.model,
          delivered: a.delivered,
          disputes: a.disputes,
          rating: a.rating,
          kind: a.kind,
        })),
      },
    };
  }
  if (name === "ask_agent") return askAgent(deps, ctx, input);
  if (name === "agent_input") {
    const p = AgentInput.safeParse(input);
    if (!p.success) return invalid("skill must be a short name (find_agents gives it)");
    const forms = await market.forms(p.data.skill);
    if (forms.length === 0)
      return { result: `No agent on the market quotes "${p.data.skill}" yet.` };
    // Agents with a skill usually share a form; show each distinct one once.
    const distinct = new Map<string, { agents: string[]; form: unknown }>();
    for (const { agent, form } of forms) {
      const id = JSON.stringify(form);
      const seen = distinct.get(id) ?? { agents: [], form };
      seen.agents.push(agent.name);
      distinct.set(id, seen);
    }
    return { result: JSON.stringify([...distinct.values()]) };
  }
  if (name === "get_quotes") {
    const p = GetQuotes.safeParse(input);
    if (!p.success) return invalid("give the skill and the form's fields as `input`");
    const { offers, problems } = await market.quotes(p.data.skill, p.data.input);
    if (offers.length === 0)
      return {
        result: problems.length
          ? `No offers. ${problems.join(" ")} Fix the input (agent_input shows the form) or ask the user.`
          : "No offers from the market's agents for that.",
      };
    const shown = offers.slice(0, 6);
    await deps.saveQuotes(ctx.chatId, shown); // only offers shown in this chat can be hired from it
    return {
      result: JSON.stringify(
        shown.map((o) => ({
          quote: o.key,
          agent: o.agent.name,
          why: o.tag,
          title: o.title,
          subtitle: o.subtitle,
          details: o.details?.slice(0, 3), // e.g. a return flight's way back
          price: o.price ? `${o.price.currency} ${Math.round(o.price.amount)}` : undefined,
          // Paid with the fee into the same escrow (testnet scale), so undo and reports cover it.
          priceInEscrow: o.priceUnits
            ? `${(Number(o.priceUnits) / 1e6).toFixed(6)} test USDC`
            : undefined,
          refundable: o.refundable,
          rating: o.rating,
          location: o.location,
          fee: `${usdc(o.feeUnits)} USDC`,
          agentModel: o.agent.service?.model,
          agentPromise: o.agent.service?.promise,
          agentRating: rated(o.agent.rating),
        })),
      ),
      card: {
        type: "quotes",
        skill: p.data.skill,
        reason: shown.some((o) => o.tag) ? "Each picked for a reason" : "Cheapest first",
        quotes: shown.map((o) => ({
          key: o.key,
          title: `${o.title} · ${o.agent.name}`,
          note: o.subtitle ?? "",
          feeUnits: o.feeUnits,
          itemTotal: o.price ? Math.round(o.price.amount) : undefined,
          priceUnits: o.priceUnits,
          itemCurrency: o.price?.currency,
          reply: `Book ${o.title} (quote ${o.key.slice(0, 10)})`,
          tag: o.tag,
          images: o.images,
          rating: o.rating,
          location: o.location,
          details: o.details,
          refundable: o.refundable,
          model: o.agent.service?.model,
          promise: o.agent.service?.promise,
          agentRating: o.agent.rating,
        })),
      },
    };
  }
  if (name === "hire") {
    const p = Hire.safeParse(input);
    if (!p.success) return invalid("give the offer's 0x key");
    try {
      const h = await deps.hire(ctx.user, ctx.chatId, p.data.quote);
      const undo = h.undoUntil ?? new Date();
      const secs = Math.max(0, Math.round((undo.getTime() - Date.now()) / 1000));
      return {
        result: `The agent is hired, but the job is NOT done yet: ${h.priceUnits ? `the trip price (₹${Number(h.priceUnits).toLocaleString("en-IN")}, at testnet scale) and ` : ""}its ${usdc(h.feeUnits.toString())} USDC fee are held in escrow; the agent pays the hotel or airline with a one-time card once it books, and for about ${secs} more seconds the user can undo with the card's Undo button (the card counts down; don't give a clock time). After that the agent does the job and the chat gets the result (e.g. a booking reference). Say this plainly; don't call it booked.`,
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
      if (err instanceof NeedsTraveller)
        return {
          result: `Not booked yet: first, who is it for? The card shows the user's saved travellers, or a form for someone new; the details stay private (they go only to ${err.card.agentName}, for the booking), so don't ask for names, emails or phone numbers in chat. Ask them to choose on the card; once they do, the app sends the booking again. Don't call hire again until then.`,
          card: err.card,
        };
      if (err instanceof NeedsHuman)
        return {
          result: `Not booked yet: ${err.card.agentName}'s fee (${usdc(err.card.feeUnits)} USDC) is a larger payment, so a real person approves it first with World ID (the card shows it: they approve in the World ID app; it proves a person, nothing about who). Ask them to approve it on the card; once they do, the app sends the booking again. If they decline, nothing is paid. Don't call hire again until then. Their approval covers one payment to ${err.card.agentName} at this fee in this chat for 10 minutes, fresh quotes from it included: if this quote expires, get fresh prices from ${err.card.agentName} and hire the same offer, without asking them to approve again.`,
          card: err.card,
        };
      if (err instanceof NeedsLimit)
        return {
          result: `Not booked yet: ${err.card.agentName} is paid from the user's own wallet, so they first approve a spending limit for it with Face ID (the card shows it: up to ${usdc(err.card.budgetUnits)} USDC in this chat for ${err.card.hours} hours). Ask them to approve it on the card; once they do, the app sends the booking again. Don't call hire again until then.`,
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
