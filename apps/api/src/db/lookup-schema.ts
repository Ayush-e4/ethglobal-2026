import { bigint, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { chats, users } from "./schema";

const at = (name: string) => timestamp(name, { withTimezone: true });

/**
 * One question to a lookup agent: asked (it needs a limit first), answered (paid on Hedera), or
 * failed. A limit for a lookup agent can only be set up in a chat that asked it something.
 */
export const lookups = pgTable("lookups", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  chatId: uuid("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  agentName: text("agent_name").notNull(),
  agentAddress: text("agent_address").notNull(), // lowercase
  skill: text("skill").notNull(),
  feeUnits: bigint("fee_units", { mode: "bigint" }).notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  status: text("status").$type<"asked" | "answered" | "failed">().notNull().default("asked"),
  title: text("title"), // what it answered
  payTx: text("pay_tx"),
  createdAt: at("created_at").notNull().defaultNow(),
});
