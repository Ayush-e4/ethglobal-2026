import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { chats, users } from "./schema";

const at = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Someone who gets paid in person (a shop, a stall): paid into their own Face ID wallet. The key
 * signs their payment requests; it stays here, never on their device or in a QR.
 */
export const merchants = pgTable("merchants", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  account: text("account").notNull().unique(), // their wallet's Hedera account, 0.0.<n>
  address: text("address").notNull(), // the same wallet's EVM address (lowercase): the limit's payee
  keyHex: text("key_hex").notNull(),
  createdAt: at("created_at").notNull().defaultNow(),
});

/** One amount a merchant asked for, shown as a Live QR or chirped: paid once, or it expires. */
export const payRequests = pgTable(
  "pay_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantUserId: uuid("merchant_user_id")
      .notNull()
      .references(() => merchants.userId, { onDelete: "cascade" }),
    nonce: bigint("nonce", { mode: "number" }).notNull(),
    frameHex: text("frame_hex").notNull().unique(),
    amountUnits: bigint("amount_units", { mode: "bigint" }).notNull(),
    expiresAt: at("expires_at").notNull(),
    status: text("status").$type<"open" | "paying" | "paid">().notNull().default("open"),
    payerUserId: uuid("payer_user_id").references(() => users.id, { onDelete: "set null" }),
    payerChatId: uuid("payer_chat_id").references(() => chats.id, { onDelete: "set null" }),
    live: boolean("live"), // the payer's camera saw the live screen (a QR scan)
    how: text("how").$type<"qr" | "sound">(),
    liveMs: integer("live_ms"),
    payTx: text("pay_tx"),
    paidAt: at("paid_at"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [index("pay_requests_merchant_idx").on(t.merchantUserId, t.createdAt)],
);
