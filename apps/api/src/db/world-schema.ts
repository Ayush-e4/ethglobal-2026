import {
  bigint,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./schema";

const at = (name: string) => timestamp(name, { withTimezone: true });

export type WorldCheckStatus =
  | "waiting"
  | "verified"
  | "denied"
  | "expired"
  | "failed"
  | "mismatch";

/**
 * World ID checks ("prove you're a person"): for the welcome bonus, to approve one larger
 * payment, or to rate an agent. The device code stays here, never in the browser, and the check survives a restart:
 * it's picked up again while it can still be approved.
 */
export const worldChecks = pgTable(
  "world_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").$type<"bonus" | "spend" | "rate">().notNull(),
    ref: text("ref"), // "spend": `chatId:agent:fee`; "rate": `hireId:score`
    userCode: text("user_code").notNull(),
    link: text("link").notNull(), // where the person approves it
    deviceCode: text("device_code").notNull(),
    intervalS: integer("interval_s").notNull(),
    startedAtS: bigint("started_at_s", { mode: "number" }).notNull(),
    expiresAt: at("expires_at").notNull(),
    status: text("status").$type<WorldCheckStatus>().notNull().default("waiting"),
    reason: text("reason"),
    endedAt: at("ended_at"),
    usedAt: at("used_at"), // a "spend" approval works once
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [index("world_checks_user_idx").on(t.userId, t.createdAt)],
);

/** The welcome bonus, once per person (their World ID): recorded before it's sent. */
export const worldBonuses = pgTable(
  "world_bonuses",
  {
    worldIss: text("world_iss").notNull(),
    worldSub: text("world_sub").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    units: bigint("units", { mode: "bigint" }).notNull(),
    status: text("status").$type<"sending" | "sent" | "failed">().notNull().default("sending"),
    tx: text("tx"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.worldIss, t.worldSub] })],
);

/**
 * Verified people's ratings, as posted to Arkiv (where anyone can read them). One per person per
 * agent: `rater` is that person's pseudonym for this agent (see world/ratings.ts), so rating it
 * again replaces it. The account and hire are kept here only, never on Arkiv.
 */
export const ratings = pgTable(
  "ratings",
  {
    rater: text("rater").notNull(),
    agent: text("agent").notNull(), // the agent's EVM address, lowercase
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hireId: uuid("hire_id").notNull(),
    score: smallint("score").notNull(),
    status: text("status").$type<"posting" | "posted" | "failed">().notNull().default("posting"),
    arkivKey: text("arkiv_key"),
    arkivTx: text("arkiv_tx"),
    erc8004Tx: text("erc8004_tx"), // the same rating as ERC-8004 feedback on Hedera
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.rater, t.agent] }), index("ratings_hire_idx").on(t.hireId)],
);
