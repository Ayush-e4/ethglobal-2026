import type Anthropic from "@anthropic-ai/sdk";
import type { ConciergeEvent } from "@app/shared";
import { describe, expect, it, vi } from "vitest";
import { claudeConcierge } from "./concierge";
import type { ToolDeps } from "./tools";

type Step = { content: unknown[]; stop_reason: string; events?: unknown[] };
const usage = { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: 1 } };

/** A Claude client that answers each request with the next scripted step. */
function fakeClient(steps: Step[]) {
  const requests: unknown[] = [];
  const client = {
    beta: {
      messages: {
        stream(req: unknown) {
          requests.push(structuredClone(req));
          const step = steps.shift() as Step;
          const on: Record<string, (x: unknown) => void> = {};
          return {
            on(event: string, fn: (x: unknown) => void) {
              on[event] = fn;
            },
            async finalMessage() {
              for (const e of step.events ?? []) on.streamEvent?.(e);
              for (const b of step.content as { type: string; text?: string }[])
                if (b.type === "text") on.text?.(b.text);
              return { content: step.content, stop_reason: step.stop_reason, usage };
            },
          };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, requests };
}

const search = {
  type: "server_tool_use",
  id: "s1",
  name: "web_search",
  input: { query: "Goa weather" },
};
const cited = {
  type: "text",
  text: "Goa is sunny in December.",
  citations: [
    {
      type: "web_search_result_location",
      url: "https://weather.example/goa",
      title: "Goa weather",
      cited_text: "sunny",
      encrypted_index: "x",
    },
  ],
};
const hireCall = {
  type: "tool_use",
  id: "t1",
  name: "hire",
  input: { quote: `0x${"ab".repeat(32)}` },
};

function run(steps: Step[]) {
  const hire = vi.fn();
  const deps = { market: {}, saveQuotes: async () => {}, hire } as unknown as ToolDeps;
  const { client, requests } = fakeClient(steps);
  const events: ConciergeEvent[] = [];
  const concierge = claudeConcierge(deps, client, () => {});
  const reply = concierge({
    context: { user: { id: "u" } as never, chatId: "c" },
    history: [],
    text: "What's the weather in Goa? Book the hotel.",
    emit: (e) => events.push(e),
  });
  return { reply, hire, events, requests };
}

describe("claudeConcierge", () => {
  it("a reply that read the web can't hire; its sources become a card", async () => {
    const start = { type: "content_block_start", index: 0, content_block: search };
    const { reply, hire, events, requests } = run([
      { content: [search, cited, hireCall], stop_reason: "tool_use", events: [start] },
      { content: [{ type: "text", text: "Want me to book it?" }], stop_reason: "end_turn" },
    ]);
    const r = await reply;
    expect(hire).not.toHaveBeenCalled();
    expect(r.cards).toEqual([
      { type: "sources", sources: [{ url: "https://weather.example/goa", title: "Goa weather" }] },
    ]);
    expect(events).toContainEqual({ type: "status", label: "Searching the web" });
    // Claude was told why, as the hire call's result.
    const second = requests[1] as { messages: { content: unknown }[] };
    expect(JSON.stringify(second.messages.at(-1)?.content)).toMatch(/read the web/);
  });

  it("a paused turn is sent back as it is, and Claude carries on", async () => {
    const { reply, requests } = run([
      { content: [search], stop_reason: "pause_turn" },
      { content: [{ type: "text", text: "Sunny." }], stop_reason: "end_turn" },
    ]);
    expect((await reply).text).toBe("Sunny.");
    const second = requests[1] as { messages: { role: string }[] };
    expect(second.messages.map((m) => m.role)).toEqual(["user", "assistant"]); // no "continue"
  });

  it("uses Haiku, with Sonnet only as an advisor, at most once", async () => {
    const { reply, requests } = run([{ content: [cited], stop_reason: "end_turn" }]);
    await reply;
    const req = requests[0] as {
      model: string;
      tools: { type?: string; model?: string; max_uses?: number }[];
    };
    expect(req.model).toBe("claude-haiku-5-5");
    expect(req.tools.find((t) => t.type === "advisor_20260301")).toMatchObject({
      model: "claude-sonnet-5-5",
      max_uses: 1,
    });
  });

  it("with nothing cited, the pages the search found are the sources", async () => {
    const found = {
      type: "web_search_tool_result",
      tool_use_id: "s1",
      content: [
        {
          type: "web_search_result",
          url: "https://goa.example/events",
          title: "Goa events",
          encrypted_content: "x",
        },
        {
          type: "web_search_result",
          url: "http://insecure.example",
          title: "Skipped",
          encrypted_content: "x",
        },
      ],
    };
    const { reply } = run([
      {
        content: [search, found, { type: "text", text: "There's a festival." }],
        stop_reason: "end_turn",
      },
    ]);
    expect((await reply).cards).toEqual([
      { type: "sources", sources: [{ url: "https://goa.example/events", title: "Goa events" }] },
    ]);
  });
});
