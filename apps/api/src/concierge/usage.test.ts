import { describe, expect, it } from "vitest";
import { costLine, replyCost } from "./usage";

describe("replyCost", () => {
  it("adds up steps, web searches and the advisor's own tokens", () => {
    const c = replyCost([
      { input_tokens: 2000, output_tokens: 200, cache_read_input_tokens: 1500 },
      {
        input_tokens: 3000,
        output_tokens: 300,
        server_tool_use: { web_search_requests: 2 },
        iterations: [{ type: "advisor_message", input_tokens: 1000, output_tokens: 400 }],
      },
    ]);
    expect(c).toMatchObject({ input: 5000, output: 500, cacheRead: 1500, searches: 2 });
    expect(c.advisor).toMatchObject({ calls: 1, input: 1000, output: 400 });
    // Haiku 0.0005 + 0.00025 + cached 0.000015; searches 0.02; Sonnet advisor 0.002 + 0.004
    expect(c.usd).toBeCloseTo(0.026765, 6);
    expect(costLine([{ input_tokens: 10, output_tokens: 5 }])).toBe(
      "1 step, in 10 (+0 cached), out 5, ≈ $0.0000",
    );
  });
});
