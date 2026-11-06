import type { Answer, Card } from "@app/shared";
import type { User } from "../db/schema";
import type { Market, MarketAgent, MarketOffer } from "./market";

/** What the tools can reach, and whose chat this is. */
export interface ToolDeps {
  market: Market;
  saveQuotes: (chatId: string, offers: MarketOffer[]) => Promise<void>;
  hire: (
    user: User,
    chatId: string,
    quoteKey: string,
  ) => Promise<{
    id: string;
    title: string;
    feeUnits: bigint;
    priceUnits?: bigint | null; // the trip price, in the same escrow
    undoUntil: Date | null;
    payTx: string | null;
  }>;
  /** Pays a lookup agent its small fee from the chat's lookup limit, and gets its answer. */
  ask?: (
    user: User,
    chatId: string,
    agent: MarketAgent,
    input: Record<string, unknown>,
  ) => Promise<{ answer: Answer; payTx: string; feeUnits: bigint }>;
}
export interface ToolContext {
  user: User;
  chatId: string;
}

export interface ToolOutcome {
  result: string; // what Claude reads
  card?: Card; // what the app draws
  isError?: boolean;
}
