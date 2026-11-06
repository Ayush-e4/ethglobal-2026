# How we use Claude

One model call in the product: the **concierge** (`apps/api/src/concierge`), through Anthropic's
TypeScript SDK (`@anthropic-ai/sdk`) on the **Messages API** (its beta surface, for the advisor
tool). We run the tool loop ourselves, which is how money rules stay in our code: Claude can ask
for things; only our code and Hedera move money.

## Models

| Model | When | Price (list, per million tokens) |
|---|---|---|
| **Claude Haiku 5.5** (`claude-haiku-5-5`), effort `low` | Every reply | $0.10 in, $0.50 out |
| **Claude Sonnet 5.5** (`claude-sonnet-5-5`), as the **advisor** | Only when Haiku asks, for hard planning; at most once per reply | $2 in, $10 out |

## Features in use

| Feature | What it does here |
|---|---|
| Streaming, with tool inputs streamed as they're written (`eager_input_streaming`) | Replies appear as they're written; status lines show which step is running |
| Our tools (the market's): `find_agents`, `agent_input`, `get_quotes`, `hire` | Each input is checked against a schema before it runs (streamed inputs can arrive cut short) |
| **Web search** (server tool, `web_search_20250305`, at most 3 per reply, location: India) | General questions: weather, events, what an area is like. The newer version with dynamic filtering is Sonnet/Opus only |
| **Citations** → a **Sources** card | What Claude cited, or else the pages its searches found |
| **Advisor** (beta `advisor-tool-2026-03-01`, `advisor_20260301`) | Haiku consults Sonnet mid-reply; Sonnet's advice comes back encrypted and is only replayed to Haiku |
| `pause_turn` | A long server-side search pauses the reply; we send it back as it is and Claude carries on |
| Prompt caching on the instructions | Later steps and replies read them from cache (most input tokens are cached) |
| Usage → a cost line per reply in the log | `concierge reply: 4 steps, in 8205 (+20032 cached), out 687, ≈ $0.0014` |

## No domain knowledge in the prompt

The instructions are about working with the market, not about hotels: which skill fits a need,
what a field means, examples and how each agent works all come from the agents' own listings on
Arkiv, as tool results ([agents.md](agents.md#the-markets-protocol-any-agent)). New kinds of
agents need no prompt change.

## Rules we added

- **A reply that read the web can't hire.** Web pages are third-party text that can carry
  instructions; booking waits for the user's own go-ahead in their next message (the hire is
  refused in code, whatever Claude asks).
- **Only offers shown in this chat can be hired**, within a spending limit enforced on Hedera,
  with an undo window ([api.md](api.md), [mandates.md](mandates.md)).
- **Cards are remembered as complete notes** in the history, so Claude never doubts a true earlier
  reply.

## Not used, on purpose

- **Strict tool use / structured outputs**: they can't be combined with citations (the API
  returns a 400), and we check every tool input ourselves anyway.
- **Agent SDK, Managed Agents, code execution**: Anthropic would run the loop or a sandbox; we
  need the loop in our code, where the money rules are.

## Live (6 Nov 2026)

- "Weather in Goa around 20 December, and what's on?" → 2 web searches, a sources card,
  ≈ $0.023.
- "Plan a relaxed 3-day trip, ₹40,000 with the hotel" → web search + the market's three hotel
  offers + a budget split, ≈ $0.013 (Haiku didn't need the advisor).
- Advisor, asked directly → one Sonnet consultation, ≈ $0.018.
- "Check online if it'll rain, and if not book the cheapest" → searched, answered, **didn't
  book**; "Yes, book it" next → hired (then undone), ≈ $0.0014.
