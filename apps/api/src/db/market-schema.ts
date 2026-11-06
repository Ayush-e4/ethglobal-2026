import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./schema";

const at = (name: string) => timestamp(name, { withTimezone: true });

export type ReviewStatus = "approved" | "failed" | "suspended";
export interface ReviewCheck {
  id: string;
  ok: boolean;
  note: string;
}

/**
 * The marketplace's review of each agent on Arkiv: the market shows only approved ones. Who
 * answers for it (us, or a person who proved they run it and are human with World ID), its last
 * checks, and how many in a row failed. Each change is also written to Arkiv, for anyone to see.
 */
export const agentReviews = pgTable("agent_reviews", {
  agent: text("agent").primaryKey(), // its address, lowercase
  status: text("status").$type<ReviewStatus>().notNull(),
  operator: text("operator").$type<"agentnet" | "verified-person">().notNull(),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  checks: jsonb("checks").$type<ReviewCheck[]>().notNull(),
  failures: integer("failures").notNull().default(0), // reviews failed in a row
  note: text("note"),
  arkivKey: text("arkiv_key"), // its newest review on Arkiv
  arkivAt: at("arkiv_at"),
  checkedAt: at("checked_at").notNull(),
  createdAt: at("created_at").notNull().defaultNow(),
});

export type AgentReview = typeof agentReviews.$inferSelect;
