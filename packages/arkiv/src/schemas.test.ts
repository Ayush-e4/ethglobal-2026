import { describe, expect, it } from "vitest";
import { AgentSchema, QuoteSchema } from "./records";
import { valuesFor } from "./schemas";

describe("records and column values", () => {
  it("keeps indexed text within Arkiv's 128-byte columns", () => {
    expect(() =>
      AgentSchema.parse({
        agent: `0x${"a".repeat(40)}`,
        name: "x".repeat(200),
        skill: "hotels",
        description: "",
        endpoint: "https://a.test",
        hederaAccount: "0.0.1",
      }),
    ).toThrow();
  });

  it("builds indexed columns plus the JSON body", () => {
    const q = QuoteSchema.parse({
      agent: `0x${"a".repeat(40)}`,
      task: "goa-trip",
      skill: "hotels",
      feeUnits: "20000",
      summary: "s",
    });
    const v = valuesFor("quote", q) as Record<string, unknown>;
    expect(Object.keys(v).sort()).toEqual(["agent", "body", "fee_units", "skill", "task"]);
  });
});
