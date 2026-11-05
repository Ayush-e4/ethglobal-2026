import type Anthropic from "@anthropic-ai/sdk";
import type { Card } from "@app/shared";
import type { Message } from "../db/schema";

/**
 * What Claude needs to remember of a card it showed earlier (it only sees text in the history):
 * the quote keys, so "book the second one" still works a turn later.
 */
export function cardNote(card: Card): string {
  if (card.type === "quotes") {
    const lines = card.quotes.map(
      (q, i) =>
        `${i + 1}. ${q.title}, ${q.itemCurrency ?? ""} ${q.itemTotal ?? ""} (quote ${q.key})`,
    );
    return `[quotes shown]\n${lines.join("\n")}`;
  }
  if (card.type === "hire")
    return `[hired: ${card.title}, fee held in escrow, hire ${card.hireId}]`;
  if (card.type === "agents") return `[agents shown: ${card.agents.map((a) => a.name).join(", ")}]`;
  return `[choices shown: ${card.options.map((o) => o.label).join(" / ")}]`;
}

/** The chat so far as Claude messages (text, plus notes for the cards). */
export function toHistory(rows: Message[], max = 30): Anthropic.MessageParam[] {
  return rows.slice(-max).map((m) => ({
    role: m.role,
    content: [m.text, ...m.cards.map(cardNote)].filter(Boolean).join("\n\n") || "(no text)",
  }));
}
