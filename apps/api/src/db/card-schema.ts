import { bigint, doublePrecision, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const at = (name: string) => timestamp(name, { withTimezone: true });

export type CardStatus = "authorized" | "captured" | "voided";

/**
 * The (mock) card issuer's ledger: one single-use card per paid job, locked to one merchant and
 * the exact amount of the trip price held in that job's escrow. Authorized when the agent books,
 * captured when the escrow pays out, voided if it's refunded. Only the last 4 digits are kept.
 */
export const agentCards = pgTable("agent_cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  escrowId: text("escrow_id").notNull().unique(),
  agent: text("agent").notNull(), // lowercase address
  merchant: text("merchant").notNull(),
  amount: doublePrecision("amount").notNull(), // in the merchant's currency
  currency: text("currency").notNull(),
  amountUnits: bigint("amount_units", { mode: "bigint" }).notNull(), // the escrowed price
  last4: text("last4").notNull(),
  status: text("status").$type<CardStatus>().notNull().default("authorized"),
  expiresAt: at("expires_at").notNull(),
  createdAt: at("created_at").notNull().defaultNow(),
  updatedAt: at("updated_at").notNull().defaultNow(),
});

export type AgentCardRow = typeof agentCards.$inferSelect;
/** What a hire shows of its card. */
export interface HireCardView {
  last4: string;
  brand: string;
  merchant: string;
  amount: number;
  currency: string;
  status: CardStatus;
  expiresAt: string;
}
