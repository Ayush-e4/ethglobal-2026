import type { Card } from "@app/shared";
import { bigint, boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const at = (name: string) => timestamp(name, { withTimezone: true });

/** A person using the app: a passkey account, or a demo account from "Try the demo". */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  isDemo: boolean("is_demo").notNull().default(false),
  displayName: text("display_name"),
  createdAt: at("created_at").notNull().defaultNow(),
});

/** One-time challenges a passkey signs. Each works once, for 5 minutes. */
export const authChallenges = pgTable("auth_challenges", {
  challenge: text("challenge").primaryKey(),
  expiresAt: at("expires_at").notNull(),
  usedAt: at("used_at"),
});

/** Signed-in sessions. Only a hash of the cookie token is stored, never the token. */
export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: at("expires_at").notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/**
 * Passkeys (Face ID, a fingerprint, a phone): the private key never leaves the device; we keep
 * the public key. P-256 only, so the same key can later control the user's wallet contract.
 */
export const passkeys = pgTable(
  "passkeys",
  {
    id: text("id").primaryKey(), // credential id (base64url), as the browser reports it
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(), // COSE, base64url
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: jsonb("transports").$type<string[]>(),
    label: text("label"),
    createdAt: at("created_at").notNull().defaultNow(),
    lastUsedAt: at("last_used_at"),
  },
  (t) => [index("passkeys_user_idx").on(t.userId)],
);

/** A conversation with the concierge. */
export const chats = pgTable(
  "chats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [index("chats_user_updated_idx").on(t.userId, t.updatedAt)],
);

/** One turn: the text, plus the cards the concierge showed with it. */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    text: text("text").notNull(),
    cards: jsonb("cards").$type<Card[]>().notNull().default([]),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [index("messages_chat_idx").on(t.chatId, t.createdAt)],
);

/** Quotes the concierge showed in a chat: only these can be booked from it. */
export const quotes = pgTable("quotes", {
  key: text("key").primaryKey(), // the quote's Arkiv entity
  chatId: uuid("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  agentName: text("agent_name").notNull(),
  agentAddress: text("agent_address").notNull(),
  endpoint: text("endpoint").notNull(),
  feeUnits: bigint("fee_units", { mode: "bigint" }).notNull(),
  summary: text("summary").notNull(),
  expiresAt: at("expires_at").notNull(),
});

/** A chat's spending limit on Hedera (a MandateRegistry mandate); the chain enforces it. */
export const limits = pgTable(
  "limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    mandateId: bigint("mandate_id", { mode: "bigint" }).notNull(),
    owner: text("owner").notNull(), // EVM address whose USDC it spends (the demo wallet, or the user's wallet)
    ownerAccount: text("owner_account").notNull(), // its Hedera id
    payee: text("payee").notNull(), // the one agent it may pay
    budgetUnits: bigint("budget_units", { mode: "bigint" }).notNull(),
    demo: boolean("demo").notNull().default(false),
    expiresAt: at("expires_at").notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [index("limits_chat_idx").on(t.chatId)],
);

export type HireStatus =
  | "paying"
  | "held"
  | "cancelled"
  | "delivered"
  | "released"
  | "refunded"
  | "failed";

/** Every agent the concierge hired: written before paying, followed to the end. */
export const hires = pgTable(
  "hires",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    quoteKey: text("quote_key").notNull(),
    agentName: text("agent_name").notNull(),
    title: text("title").notNull(),
    feeUnits: bigint("fee_units", { mode: "bigint" }).notNull(),
    demo: boolean("demo").notNull().default(false),
    status: text("status").$type<HireStatus>().notNull().default("paying"),
    escrowId: text("escrow_id"),
    payTx: text("pay_tx"), // the Hedera transaction that held the fee
    undoUntil: at("undo_until"),
    jobUrl: text("job_url"),
    bookingRef: text("booking_ref"),
    note: text("note"),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [index("hires_chat_idx").on(t.chatId), index("hires_status_idx").on(t.status)],
);

export type User = typeof users.$inferSelect;
export type Hire = typeof hires.$inferSelect;
export type Limit = typeof limits.$inferSelect;
export type Chat = typeof chats.$inferSelect;
export type Message = typeof messages.$inferSelect;
