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

export type User = typeof users.$inferSelect;
