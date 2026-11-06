import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./schema";

const at = (name: string) => timestamp(name, { withTimezone: true });

/**
 * An account's saved travellers (up to 5): who a booking can be for. Private to the account;
 * the chosen one's details go only to the agent hired for that booking (and on to the hotel or airline),
 * never to Arkiv, and never to the concierge's model.
 */
export const travellers = pgTable(
  "travellers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    bornOn: text("born_on"), // YYYY-MM-DD: flights need it
    gender: text("gender"), // "f" | "m", as on the ID: flights need it
    isSelf: boolean("is_self").notNull().default(false), // "Me"
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [index("travellers_user_idx").on(t.userId)],
);

export type Traveller = typeof travellers.$inferSelect;
