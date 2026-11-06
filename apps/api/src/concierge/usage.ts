/**
 * What a chat reply cost, from the API's usage numbers, at list prices (an estimate: the
 * invoice is the truth). Haiku 5.5 does the work; Sonnet 5.5 only when it was asked as advisor.
 */
const PER_MTOK = {
  haiku: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  sonnet: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};
const PER_SEARCH = 10 / 1000; // web search: $10 per 1,000 searches, plus its tokens

/** The parts of an API response's `usage` we read (any SDK version's shape). */
export interface StepUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number } | null;
  iterations?: ReadonlyArray<{
    type: string;
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  }> | null;
}

export function replyCost(steps: StepUsage[]) {
  const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0 };
  const advisor = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };
  for (const u of steps) {
    t.input += u.input_tokens;
    t.output += u.output_tokens;
    t.cacheRead += u.cache_read_input_tokens ?? 0;
    t.cacheWrite += u.cache_creation_input_tokens ?? 0;
    t.searches += u.server_tool_use?.web_search_requests ?? 0;
    for (const it of u.iterations ?? []) {
      if (it.type !== "advisor_message") continue;
      advisor.calls += 1;
      advisor.input += it.input_tokens ?? 0;
      advisor.output += it.output_tokens ?? 0;
      advisor.cacheRead += it.cache_read_input_tokens ?? 0;
      advisor.cacheWrite += it.cache_creation_input_tokens ?? 0;
    }
  }
  const price = (n: typeof t | typeof advisor, p: (typeof PER_MTOK)["haiku"]) =>
    (n.input * p.input +
      n.output * p.output +
      n.cacheRead * p.cacheRead +
      n.cacheWrite * p.cacheWrite) /
    1e6;
  const usd = price(t, PER_MTOK.haiku) + price(advisor, PER_MTOK.sonnet) + t.searches * PER_SEARCH;
  return { ...t, advisor, usd };
}

/** One log line per reply: what it used and about what it cost. */
export function costLine(steps: StepUsage[]) {
  const c = replyCost(steps);
  const parts = [
    `${steps.length} step${steps.length === 1 ? "" : "s"}`,
    `in ${c.input} (+${c.cacheRead} cached)`,
    `out ${c.output}`,
    c.searches ? `${c.searches} web search${c.searches === 1 ? "" : "es"}` : null,
    c.advisor.calls ? `advisor ${c.advisor.input}/${c.advisor.output}` : null,
    `≈ $${c.usd.toFixed(4)}`,
  ];
  return parts.filter(Boolean).join(", ");
}
