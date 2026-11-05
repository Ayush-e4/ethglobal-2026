import Anthropic from "@anthropic-ai/sdk";
import type { Card, ConciergeEvent } from "@app/shared";
import type { Market } from "./market";
import { systemPrompt } from "./prompt";
import { runTool, TOOLS } from "./tools";

/** Project rule: Claude Haiku by default (fast, cheap). */
export const MODEL = "claude-haiku-5-5";
const MAX_STEPS = 6;

export interface ConciergeInput {
  history: Anthropic.MessageParam[];
  text: string;
  emit: (event: ConciergeEvent) => void;
  signal?: AbortSignal;
}

export interface ConciergeReply {
  text: string;
  cards: Card[];
}

/** Anything that can answer a chat turn. The real one is Claude; tests use a fake. */
export type Concierge = (input: ConciergeInput) => Promise<ConciergeReply>;

const STATUS: Record<string, string> = {
  find_agents: "Looking at the market",
  get_hotel_quotes: "Asking hotel agents for live prices",
};

/**
 * One chat turn with Claude: a streaming tool loop. Text streams to the app as it's written;
 * each tool result becomes a card. Tool inputs are validated before running; a refusal or a
 * truncated turn stops the loop instead of running half a tool call.
 */
export function claudeConcierge(market: Market, client = new Anthropic()): Concierge {
  return async ({ history, text, emit, signal }) => {
    const messages: Anthropic.MessageParam[] = [...history, { role: "user", content: text }];
    let reply = "";
    const cards: Card[] = [];
    for (let step = 0; step < MAX_STEPS; step++) {
      const stream = client.messages.stream(
        {
          model: MODEL,
          max_tokens: 8000,
          output_config: { effort: "low" }, // chat: short answers, quick tool calls
          system: [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }],
          tools: TOOLS,
          messages,
        },
        { signal },
      );
      stream.on("text", (delta) => {
        reply += delta;
        emit({ type: "text", delta });
      });
      let message: Anthropic.Message;
      try {
        message = await stream.finalMessage();
      } catch (err) {
        if (err instanceof Anthropic.APIError) throw err;
        continue; // a tool input that couldn't be parsed at all: ask again
      }
      if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") break;
      const calls = message.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      if (calls.length === 0) break;
      messages.push({ role: "assistant", content: message.content });
      const results = await Promise.all(
        calls.map(async (call): Promise<Anthropic.ToolResultBlockParam> => {
          emit({ type: "status", label: STATUS[call.name] ?? "Working" });
          const out = await runTool(market, call.name, call.input).catch(() => ({
            result: "The tool failed; say so briefly and offer to try again.",
            isError: true,
            card: undefined,
          }));
          if (out.card) {
            cards.push(out.card);
            emit({ type: "card", card: out.card });
          }
          return {
            type: "tool_result",
            tool_use_id: call.id,
            content: out.result,
            is_error: out.isError,
          };
        }),
      );
      messages.push({ role: "user", content: results });
      if (reply && !reply.endsWith("\n")) {
        reply += "\n\n";
        emit({ type: "text", delta: "\n\n" });
      }
    }
    return { text: reply.trim(), cards };
  };
}
