import { describe, expect, it } from "vitest";
import { cardNote } from "./history";

// Each note must carry what its card showed, or Claude doubts its own earlier reply next turn.
describe("card notes in the history", () => {
  it("a limit card keeps its terms", () => {
    const note = cardNote({
      type: "limit",
      agentName: "StayWise",
      payee: `0x${"a7".repeat(20)}`,
      budgetUnits: "100000",
      capUnits: "50000",
      hours: 24,
      reply: "Limit approved. Book it",
    });
    for (const fact of ["Face ID", "0.10 USDC", "0.05 USDC", "StayWise", "24 hours"])
      expect(note).toContain(fact);
  });

  it("quotes keep price, fee and key; a hire keeps its fee and undo deadline", () => {
    const quotes = cardNote({
      type: "quotes",
      skill: "hotels",
      reason: "Cheapest first",
      quotes: [
        {
          key: `0x${"ab".repeat(32)}`,
          title: "Park Inn · StayWise",
          note: "Standard room, free cancellation",
          feeUnits: "20000",
          itemTotal: 11927,
          itemCurrency: "INR",
          reply: "Book it",
        },
      ],
    });
    for (const fact of ["INR 11927", "0.02 USDC", "free cancellation", `0x${"ab".repeat(32)}`])
      expect(quotes).toContain(fact);
    const hire = cardNote({
      type: "hire",
      hireId: "h1",
      title: "Park Inn · 20–22 Dec",
      feeUnits: "20000",
      undoUntil: "2026-11-06T00:54:00.000Z",
      payTx: "0.0.1@2.3",
    });
    for (const fact of ["0.02 USDC", "2026-11-06T00:54:00.000Z", "escrow"])
      expect(hire).toContain(fact);
  });
});
