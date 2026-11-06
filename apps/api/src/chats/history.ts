import type Anthropic from "@anthropic-ai/sdk";
import type { Card } from "@app/shared";
import type { Message } from "../db/schema";

const usdc = (units: string) => `${(Number(units) / 1e6).toFixed(2)} USDC`;

/**
 * What Claude remembers of a card it showed earlier: it only sees text in the history, so each
 * note carries every fact the card showed (prices, fees, terms, keys). A fact missing here makes
 * Claude doubt its own earlier reply ("I shouldn't have said 0.10 USDC") on the next turn.
 */
export function cardNote(card: Card): string {
  switch (card.type) {
    case "quotes": {
      const lines = card.quotes.map((q, i) => {
        const r = q.rating;
        const facts = [
          q.note,
          `${q.itemCurrency ?? ""} ${q.itemTotal ?? ""}`.trim(),
          q.refundable ? "free cancellation" : null,
          r?.stars ? `${r.stars} stars` : null,
          r?.score ? `guests ${r.score}/10${r.reviews ? ` (${r.reviews} reviews)` : ""}` : null,
          q.location,
          `agent fee ${usdc(q.feeUnits)}`,
        ];
        return `${i + 1}. ${q.title}${q.tag ? ` [${q.tag}]` : ""}: ${facts.filter(Boolean).join(", ")} (quote ${q.key})`;
      });
      return `[quotes shown]\n${lines.join("\n")}`;
    }
    case "hire":
      return `[hired: ${card.title}; fee ${usdc(card.feeUnits)} held in escrow; undo possible until ${card.undoUntil}; hire ${card.hireId}]`;
    case "agents":
      return `[agents shown: ${card.agents.map((a) => `${a.name} (${a.skill}, fee ${usdc(a.priceUnits)})`).join(", ")}]`;
    case "limit":
      return `[limit card shown: the user approves with Face ID a spending limit from their own wallet: up to ${usdc(card.budgetUnits)} in this chat, at most ${usdc(card.capUnits)} a payment, only to ${card.agentName}, for ${card.hours} hours]`;
    case "sources":
      return `[web sources shown: ${card.sources.map((x) => x.title).join("; ")}]`;
    case "options":
      return `[choices shown: ${card.options.map((o) => o.label).join(" / ")}]`;
  }
}

/** The chat so far as Claude messages (text, plus notes for the cards). */
export function toHistory(rows: Message[], max = 30): Anthropic.Beta.Messages.BetaMessageParam[] {
  return rows.slice(-max).map((m) => ({
    role: m.role,
    content: [m.text, ...m.cards.map(cardNote)].filter(Boolean).join("\n\n") || "(no text)",
  }));
}
