import type { Card } from "@app/shared";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const at = (name: string) => timestamp(name, { withTimezone: true });

/**
 * A person using the app: a passkey account, or a demo account from "Try the demo". Their World
 * ID, once they prove they're a person with it: one World ID per account, one account per World ID.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    isDemo: boolean("is_demo").notNull().default(false),
    displayName: text("display_name"),
    worldIss: text("world_iss"),
    worldSub: text("world_sub"), // the same person always gets the same one, for this app only
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_world_idx").on(t.worldIss, t.worldSub)],
);

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
    onWallet: boolean("on_wallet").notNull().default(false), // a key on the user's Face ID wallet
    createdAt: at("created_at").notNull().defaultNow(),
    lastUsedAt: at("last_used_at"),
  },
  (t) => [index("passkeys_user_idx").on(t.userId)],
);

export type WalletStatus = "creating" | "ready" | "failed";

/** What a prepared Face ID approval is for, so its second step can be checked against it. */
export type WalletOpMeta =
  | {
      kind: "limit";
      chatId: string;
      payee: string;
      budgetUnits: string;
      expiresAt: string; // ISO, the limit's
    }
  | { kind: "revoke"; limitId: string }
  | { kind: "device"; passkeyId: string; add: boolean }; // let a device approve, or shut it out

/**
 * A move a Face ID wallet is about to make: the batch, and the digest its passkey signs. Kept
 * here (not in memory) so an approval survives a restart; each one works once, for 5 minutes.
 */
export const walletOps = pgTable("wallet_ops", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  wallet: text("wallet").notNull(),
  calls: jsonb("calls").$type<{ to: string; value: string; data: string }[]>().notNull(),
  deadline: bigint("deadline", { mode: "bigint" }).notNull(), // unix seconds
  digest: text("digest").notNull(),
  meta: jsonb("meta").$type<WalletOpMeta>().notNull(),
  expiresAt: at("expires_at").notNull(),
  usedAt: at("used_at"),
});

/**
 * Each passkey account's Face ID wallet on Hedera: a contract only its passkeys control. Made at
 * sign-up by the sponsor (which pays the gas and gives `giftUnits` of test USDC to start).
 */
export const wallets = pgTable("wallets", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  address: text("address").notNull(), // EVM address, known before the wallet exists
  hederaId: text("hedera_id"), // 0.0.x, once the mirror shows it
  status: text("status").$type<WalletStatus>().notNull().default("creating"),
  giftUnits: bigint("gift_units", { mode: "bigint" }), // null: no gift (yet)
  createdAt: at("created_at").notNull().defaultNow(),
});

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
    revokedAt: at("revoked_at"), // cancelled by its owner (with Face ID)
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
    // A watching agent (PriceGuard) keeps working after it's paid: followed until its watch ends.
    watching: boolean("watching").notNull().default(false),
    rebooksSeen: integer("rebooks_seen").notNull().default(0),
    watchNote: text("watch_note"), // e.g. "Saved ₹800 · 1 rebook · watching until 20 Dec"
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [index("hires_chat_idx").on(t.chatId), index("hires_status_idx").on(t.status)],
);

/**
 * Phone alerts: the Telegram chat a user linked with our bot (one chat per account, one account
 * per chat), by tapping Start on a one-time link. Until then, `linkCode` waits for that tap.
 */
export const alertChannels = pgTable(
  "alert_channels",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    telegramChatId: text("telegram_chat_id"),
    linkCode: text("link_code"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("alert_channels_chat_idx").on(t.telegramChatId)],
);

export type User = typeof users.$inferSelect;
export type Hire = typeof hires.$inferSelect;
export type Wallet = typeof wallets.$inferSelect;
export type Limit = typeof limits.$inferSelect;
export type Chat = typeof chats.$inferSelect;
export type Message = typeof messages.$inferSelect;

// World ID: checks, the welcome bonus, verified ratings.
export * from "./world-schema";
