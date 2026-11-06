import type { Card } from "@app/shared";
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { chats, type Traveller, travellers, type User } from "../db/schema";

export const MAX_TRAVELLERS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A guest as a hotel needs them; a flight also needs the date of birth and gender (on the ID). */
export const GuestSchema = z.object({
  firstName: z.string().trim().min(1).max(40),
  lastName: z.string().trim().min(1).max(40),
  email: z.email().max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9 ()-]{5,18}[0-9]$/, "a phone number, like +91 98000 00000"),
  bornOn: z.iso
    .date("a date of birth, like 1990-05-14")
    .refine(
      (d) => d > "1900-01-01" && d < new Date().toISOString().slice(0, 10),
      "a real date of birth",
    )
    .optional(),
  gender: z.enum(["f", "m"]).optional(),
});
export type Guest = z.infer<typeof GuestSchema>;

export const guestOf = (t: Traveller): Guest => ({
  firstName: t.firstName,
  lastName: t.lastName,
  email: t.email,
  phone: t.phone,
  ...(t.bornOn ? { bornOn: t.bornOn } : {}),
  ...(t.gender === "f" || t.gender === "m" ? { gender: t.gender } : {}),
});

/** Booking needs to know who it's for first (the card). */
export class NeedsTraveller extends Error {
  constructor(readonly card: Extract<Card, { type: "traveller" }>) {
    super(`booking ${card.agentName} needs to know who it's for`);
  }
}

/** Asked by hiring before it pays: the chat's chosen traveller, or NeedsTraveller. */
export type GuestGate = (
  user: User,
  chatId: string,
  quote: { key: string; agentName: string; summary: string },
) => Promise<Guest>;

export class TravellerError extends Error {}

/**
 * Saved travellers (up to 5 an account), and who each chat's bookings are for. The details stay
 * here: the hire sends the chosen guest only to the agent it pays, for that booking.
 */
export function travellerService(db: Db) {
  const mine = (userId: string, id: string) =>
    and(eq(travellers.id, id), eq(travellers.userId, userId));

  async function get(userId: string, id: string) {
    if (!UUID.test(id)) return null;
    const [t] = await db.select().from(travellers).where(mine(userId, id));
    return t ?? null;
  }

  return {
    get,

    list: (userId: string) =>
      db
        .select()
        .from(travellers)
        .where(eq(travellers.userId, userId))
        .orderBy(asc(travellers.createdAt)),

    async add(userId: string, guest: Guest, isSelf = false): Promise<Traveller> {
      const [n] = await db
        .select({ n: count() })
        .from(travellers)
        .where(eq(travellers.userId, userId));
      if ((n?.n ?? 0) >= MAX_TRAVELLERS)
        throw new TravellerError(`Up to ${MAX_TRAVELLERS} travellers: remove one first`);
      if (isSelf)
        await db.update(travellers).set({ isSelf: false }).where(eq(travellers.userId, userId));
      const [t] = await db
        .insert(travellers)
        .values({ userId, ...guest, isSelf })
        .returning();
      if (!t) throw new Error("could not save the traveller");
      return t;
    },

    async update(userId: string, id: string, guest: Guest, isSelf?: boolean) {
      if (!(await get(userId, id))) throw new TravellerError("No such traveller");
      if (isSelf)
        await db.update(travellers).set({ isSelf: false }).where(eq(travellers.userId, userId));
      const [t] = await db
        .update(travellers)
        .set({
          ...guest,
          bornOn: guest.bornOn ?? null, // left out: cleared
          gender: guest.gender ?? null,
          ...(isSelf === undefined ? {} : { isSelf }),
        })
        .where(mine(userId, id))
        .returning();
      return t as Traveller;
    },

    async remove(userId: string, id: string) {
      if (!(await get(userId, id))) return false;
      await db
        .update(chats)
        .set({ travellerId: null })
        .where(and(eq(chats.userId, userId), eq(chats.travellerId, id)));
      await db.delete(travellers).where(mine(userId, id));
      return true;
    },

    /** This chat's bookings are for this traveller (both must be the user's). */
    async choose(userId: string, chatId: string, travellerId: string) {
      if (!UUID.test(chatId) || !(await get(userId, travellerId))) return false;
      const done = await db
        .update(chats)
        .set({ travellerId })
        .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
        .returning({ id: chats.id });
      return done.length > 0;
    },

    async chosen(userId: string, chatId: string): Promise<Traveller | null> {
      if (!UUID.test(chatId)) return null;
      const [c] = await db
        .select({ travellerId: chats.travellerId })
        .from(chats)
        .where(and(eq(chats.id, chatId), eq(chats.userId, userId)));
      return c?.travellerId ? get(userId, c.travellerId) : null;
    },

    /** The guest gate: the chat's traveller, or ask who it's for (the card). */
    gate(): GuestGate {
      return async (user, chatId, quote) => {
        const t = await this.chosen(user.id, chatId);
        if (t) return guestOf(t);
        throw new NeedsTraveller({
          type: "traveller",
          agentName: quote.agentName,
          reply: `Traveller chosen. Book ${quote.summary} (quote ${quote.key.slice(0, 10)})`,
        });
      };
    },
  };
}

export type TravellerService = ReturnType<typeof travellerService>;

/**
 * A guest typed in one message (Telegram): "Asha Rao, asha@example.com, +91 98000 00000", in any
 * order. The email and phone are found by their shape; the rest is the name (first, then last).
 */
export function parseGuest(text: string): Guest | { error: string } {
  const email = /[^\s,;<>]+@[^\s,;<>]+\.[a-z]{2,}/i.exec(text)?.[0];
  let rest = text.replace(email ?? "", "");
  // A date of birth (for flights), before the phone number: its digits would look like one.
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(rest);
  const dmy = iso ? null : /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/.exec(rest);
  const bornOn = iso
    ? `${iso[1]}-${iso[2]}-${iso[3]}`
    : dmy
      ? `${dmy[3]}-${dmy[2]?.padStart(2, "0")}-${dmy[1]?.padStart(2, "0")}`
      : undefined;
  rest = rest.replace((iso ?? dmy)?.[0] ?? "", "");
  const phone = /\+?\d[\d ()-]{5,18}\d/.exec(rest)?.[0];
  rest = rest.replace(phone ?? "", "");
  const all = rest.split(/[\s,;]+/).filter((w) => /\p{L}/u.test(w));
  const genderWord = all.find((w) => /^(female|male|woman|man|f|m)$/i.test(w));
  const gender = genderWord ? (/^(female|woman|f)$/i.test(genderWord) ? "f" : "m") : undefined;
  const words = all.filter((w) => w !== genderWord);
  const parsed = GuestSchema.safeParse({
    firstName: words[0],
    lastName: words.slice(1).join(" "),
    email,
    phone,
    ...(bornOn ? { bornOn } : {}),
    ...(gender ? { gender } : {}),
  });
  if (parsed.success) return parsed.data;
  const missing = [
    !words[1] && "first and last name",
    !email && "an email",
    !phone && "a phone number",
  ]
    .filter(Boolean)
    .join(", ");
  return {
    error: missing ? `I need ${missing}` : (parsed.error.issues[0]?.message ?? "check the details"),
  };
}
