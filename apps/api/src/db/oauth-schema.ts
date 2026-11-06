import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { chats, users } from "./schema";

const at = (name: string) => timestamp(name, { withTimezone: true });

/** Apps that registered to connect (OAuth dynamic client registration): Claude, for one. */
export const oauthClients = pgTable("oauth_clients", {
  id: text("id").primaryKey(), // the client_id we gave it
  name: text("name").notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  createdAt: at("created_at").notNull().defaultNow(),
});

/**
 * One "connect this app" request, from the app's redirect to the user's answer. Approving it
 * gives a one-time code (only its hash is kept) that the app swaps for tokens, with PKCE.
 */
export const oauthRequests = pgTable("oauth_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  state: text("state"),
  codeChallenge: text("code_challenge").notNull(), // S256
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").unique(),
  expiresAt: at("expires_at").notNull(),
  answeredAt: at("answered_at"),
  usedAt: at("used_at"),
  createdAt: at("created_at").notNull().defaultNow(),
});

/**
 * An app the user connected: its current access and refresh tokens (hashes only; both rotate),
 * and the chat its work shows up in. Disconnecting revokes it at once.
 */
export const oauthGrants = pgTable(
  "oauth_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chatId: uuid("chat_id").references(() => chats.id, { onDelete: "set null" }),
    accessHash: text("access_hash").notNull().unique(),
    accessExpiresAt: at("access_expires_at").notNull(),
    refreshHash: text("refresh_hash").notNull().unique(),
    refreshExpiresAt: at("refresh_expires_at").notNull(),
    lastUsedAt: at("last_used_at"),
    revokedAt: at("revoked_at"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [index("oauth_grants_user_idx").on(t.userId)],
);

export type OAuthGrant = typeof oauthGrants.$inferSelect;
