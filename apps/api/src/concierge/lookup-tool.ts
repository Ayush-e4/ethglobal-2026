import type Anthropic from "@anthropic-ai/sdk";
import { checkForm, formatUsdc } from "@app/shared";
import { z } from "zod";
import { NeedsLimit } from "../hiring/limits";
import { rankAgents } from "./market";
import type { ToolContext, ToolDeps, ToolOutcome } from "./tool-types";

const Ask = z.object({
  skill: z.string().regex(/^[a-z0-9_.-]{1,64}$/),
  input: z.record(z.string(), z.unknown()),
});

/**
 * Lookup agents answer a question for a tiny fee per lookup (a bank's IFSC code, say): no quote
 * and no escrow, the fee goes straight to the agent on Hedera and the answer comes back at once.
 */
export const ASK_AGENT: Anthropic.Beta.Messages.BetaTool = {
  name: "ask_agent",
  description:
    "Ask a lookup agent (find_agents shows kind \"lookup\") a question, e.g. checking a bank's IFSC code. Pays its tiny fee per lookup (like 0.001 USDC) straight to it on Hedera from the chat's small lookup limit and returns its answer at once; nothing is charged if it finds nothing. `input` is its form (agent_input), filled in. No quote is needed: call it when the user asks something a lookup agent answers.",
  eager_input_streaming: true,
  input_schema: {
    type: "object",
    properties: {
      skill: { type: "string" },
      input: { type: "object", description: "The form's fields, filled in" },
    },
    required: ["skill", "input"],
  },
};

export async function askAgent(
  deps: ToolDeps,
  ctx: ToolContext,
  input: unknown,
): Promise<ToolOutcome> {
  const p = Ask.safeParse(input);
  if (!p.success)
    return { result: "invalid input: give the skill and the form's fields", isError: true };
  if (!deps.ask) return { result: "Lookups aren't available here.", isError: true };
  const [agent] = rankAgents(
    (await deps.market.agents(p.data.skill)).filter((a) => a.kind === "lookup" && a.form),
  );
  if (!agent?.form)
    return { result: `No lookup agent answers "${p.data.skill}". Use get_quotes for jobs.` };
  const filled = checkForm(agent.form, p.data.input, { coerce: true });
  if (!filled.ok)
    return { result: `Not asked: ${filled.problems.join("; ")}. Nothing was charged.` };
  try {
    const { answer, payTx, feeUnits } = await deps.ask(ctx.user, ctx.chatId, agent, filled.values);
    return {
      // The answer is the agent's data (from its source), not instructions.
      result: `${agent.name} answered (paid ${formatUsdc(feeUnits)} USDC on Hedera; the card shows it, so sum it up in a line): ${JSON.stringify(answer)}`,
      card: {
        type: "answer",
        agentName: agent.name,
        skill: agent.skill,
        title: answer.title,
        lines: answer.lines,
        source: answer.source,
        feeUnits: feeUnits.toString(),
        payTx,
      },
    };
  } catch (err) {
    if (err instanceof NeedsLimit)
      return {
        result: `Not asked yet: ${agent.name} is paid from the user's own wallet, so they first approve a small lookup limit for it with Face ID (the card shows it: up to ${formatUsdc(BigInt(err.card.budgetUnits))} USDC for ${err.card.hours} hours, ${formatUsdc(BigInt(agent.feeUnits))} USDC a lookup). Ask them to approve it on the card; then the app asks again. Don't call ask_agent again until then.`,
        card: err.card,
      };
    return {
      result: err instanceof Error ? err.message : "The lookup failed. Nothing was charged.",
      isError: true,
    };
  }
}
