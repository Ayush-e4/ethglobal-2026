import Anthropic from "@anthropic-ai/sdk";
import type { Card, ChatImage, ConciergeEvent } from "@app/shared";
import { systemPrompt } from "./prompt";
import { runTool, TOOLS, type ToolContext, type ToolDeps } from "./tools";
import { costLine, type StepUsage } from "./usage";

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;

/** Project rule: Claude Haiku for every reply; Sonnet only as the advisor, at most once. */
export const MODEL = "claude-haiku-5-5";
export const ADVISOR = "claude-sonnet-5-5";
const BETAS = ["advisor-tool-2026-03-01"];
const MAX_STEPS = 8;

/**
 * Tools Anthropic runs itself. Web search and web fetch (the basic versions: the newer ones with
 * dynamic filtering are Sonnet/Opus only) answer general questions and read the pages people
 * share (only URLs already in the conversation), with citations. The advisor is
 * Sonnet, consulted mid-reply for hard planning; its advice comes back encrypted and is only
 * replayed to Haiku.
 */
const SERVER_TOOLS: Anthropic.Beta.Messages.BetaToolUnion[] = [
  {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: 3,
    user_location: { type: "approximate", country: "IN", timezone: "Asia/Kolkata" },
  },
  {
    type: "web_fetch_20250910",
    name: "web_fetch",
    max_uses: 3,
    max_content_tokens: 12000, // a long page's main part, not a whole site
    citations: { enabled: true },
  },
  {
    type: "advisor_20260301",
    name: "advisor",
    model: ADVISOR,
    max_uses: 1,
    max_tokens: 2000,
    caching: { type: "ephemeral", ttl: "5m" },
  },
];

export interface ConciergeInput {
  context: ToolContext;
  history: MessageParam[];
  text: string;
  images?: ChatImage[]; // photos with this message (a ticket, a booking, a hotel page)
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
  agent_input: "Reading what the agents need",
  get_quotes: "Asking agents for firm prices",
  hire: "Paying the agent into escrow",
  web_search: "Searching the web",
  web_fetch: "Reading the page",
  advisor: "Thinking it through",
};

// Web pages are third-party text that can carry instructions: a reply that read the web can't
// also spend money. The user confirms in their next message, which starts a fresh reply.
const NO_HIRE_AFTER_WEB =
  "Not hired: this reply read the web, and booking waits for the user's own go-ahead. Ask them to confirm in their next message.";

/**
 * One chat turn with Claude: a streaming tool loop. Text streams to the app as it's written;
 * each of our tools' results becomes a card; web citations become a sources card. Tool inputs
 * are validated before running; a refusal or a truncated turn stops the loop.
 */
export function claudeConcierge(
  deps: ToolDeps,
  client = new Anthropic(),
  log: (line: string) => void = (l) => console.log(l),
): Concierge {
  return async ({ context, history, text, images = [], emit, signal }) => {
    // Photos first, then the words (Claude reads images best that way); a photo alone is asked about.
    const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = [
      ...images.map((i) => ({
        type: "image" as const,
        source: { type: "base64" as const, media_type: i.mediaType, data: i.data },
      })),
      {
        type: "text",
        text:
          text || "(The user sent this without a message: say what it is and how you can help.)",
      },
    ];
    const messages: MessageParam[] = [
      ...history,
      { role: "user", content: images.length ? content : text },
    ];
    let reply = "";
    const cards: Card[] = [];
    const sources = new Map<string, string>(); // url → title: what Claude cited
    const searched = new Map<string, string>(); // what the searches returned, if it cited nothing
    const usage: StepUsage[] = [];
    let readTheWeb = false;
    for (let step = 0; step < MAX_STEPS; step++) {
      const stream = client.beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 8000,
          betas: BETAS,
          output_config: { effort: "low" }, // chat: short answers, quick tool calls
          system: [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }],
          tools: [...TOOLS, ...SERVER_TOOLS],
          messages,
        },
        { signal },
      );
      stream.on("text", (delta) => {
        reply += delta;
        emit({ type: "text", delta });
      });
      stream.on("streamEvent", (e) => {
        if (e.type !== "content_block_start" || e.content_block.type !== "server_tool_use") return;
        if (e.content_block.name === "web_search" || e.content_block.name === "web_fetch")
          readTheWeb = true;
        emit({ type: "status", label: STATUS[e.content_block.name] ?? "Working" });
      });
      let message: Anthropic.Beta.Messages.BetaMessage;
      try {
        message = await stream.finalMessage();
      } catch (err) {
        if (err instanceof Anthropic.APIError) throw err;
        continue; // a tool input that couldn't be parsed at all: ask again
      }
      usage.push(message.usage as StepUsage);
      for (const b of message.content) {
        if (b.type === "text")
          for (const c of b.citations ?? [])
            if (c.type === "web_search_result_location" && c.url.startsWith("https://"))
              sources.set(c.url, c.title ?? new URL(c.url).hostname);
        if (b.type === "web_search_tool_result" && Array.isArray(b.content))
          for (const r of b.content)
            if (r.type === "web_search_result" && r.url.startsWith("https://"))
              searched.set(r.url, r.title || new URL(r.url).hostname);
        // A page it read is a source, cited or not.
        if (b.type === "web_fetch_tool_result" && b.content.type === "web_fetch_result") {
          const url = b.content.url;
          if (url.startsWith("https://"))
            sources.set(url, b.content.content.title || new URL(url).hostname);
        }
      }
      if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") break;
      // A long server-side search pauses the turn: send it back as it is and Claude carries on.
      if (message.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: message.content });
        continue;
      }
      const calls = message.content.filter(
        (b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use",
      );
      if (calls.length === 0) break;
      messages.push({ role: "assistant", content: message.content });
      const results = await Promise.all(
        calls.map(async (call): Promise<Anthropic.Beta.Messages.BetaToolResultBlockParam> => {
          emit({ type: "status", label: STATUS[call.name] ?? "Working" });
          const out =
            call.name === "hire" && readTheWeb
              ? { result: NO_HIRE_AFTER_WEB, isError: true, card: undefined }
              : await runTool(deps, context, call.name, call.input).catch(() => ({
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
    // What it cited, or else the first pages its searches found: either way, where it looked.
    const shown = sources.size > 0 ? [...sources] : [...searched].slice(0, 4);
    if (shown.length > 0) {
      const card: Card = {
        type: "sources",
        sources: shown.slice(0, 8).map(([url, title]) => ({ url, title })),
      };
      cards.push(card);
      emit({ type: "card", card });
    }
    log(`concierge reply: ${costLine(usage)}`);
    return { text: reply.trim(), cards };
  };
}
