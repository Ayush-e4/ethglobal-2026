import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { hires, users } from "./schema";

const at = (name: string) => timestamp(name, { withTimezone: true });

export type ClaimStatus = "claimed" | "applied" | "paid" | "failed";

/**
 * A claim on a deal drop: one per person per drop (World ID's nullifier for the drop's action,
 * unique here), and one per account. Applied to the next booking, paid when that booking's
 * agent is paid. The nullifier says nothing about who the person is.
 */
export const dealClaims = pgTable(
  "deal_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dropId: text("drop_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nullifier: text("nullifier").notNull(), // decimal: one person, this drop's action
    status: text("status").$type<ClaimStatus>().notNull().default("claimed"),
    hireId: uuid("hire_id").references(() => hires.id, { onDelete: "set null" }),
    payTx: text("pay_tx"),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("deal_claims_person").on(t.dropId, t.nullifier),
    unique("deal_claims_account").on(t.dropId, t.userId),
  ],
);

export type DealClaim = typeof dealClaims.$inferSelect;
