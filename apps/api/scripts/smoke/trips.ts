// Bookings from the demo account: a hotel undone; a hotel delivered, then reported (refunded);
// a flight delivered, then cancelled afterwards. Each with its card, receipt and trip.
import { type Card, check, type Session, until } from "./http";

type Hire = {
  id: string;
  status: string;
  bookingRef: string | null;
  card: { status?: string; last4?: string } | null;
  bookingCancelledAt: string | null;
};
type Quote = { key: string; title: string; reply: string; priceUnits?: string };

const hireOf = (s: Session, chat: string, id: string) => async () =>
  ((await s.req("GET", `/chats/${chat}/hires`)).json as Hire[]).find((h) => h.id === id);

/** Asks for offers; returns them (the quotes card). */
async function offers(s: Session, chat: string, ask: string, what: string) {
  const turn = await s.say(chat, ask);
  const card = turn.cards.find((c: Card) => c.type === "quotes") as { quotes: Quote[] } | undefined;
  check(
    `chat: ${what} offers`,
    (card?.quotes.length ?? 0) > 0,
    card ? `${card.quotes.length} offers` : turn.words.slice(0, 140),
  );
  return card?.quotes ?? [];
}

const quotesIn = (cards: Card[]) =>
  (cards.find((c: Card) => c.type === "quotes") as { quotes: Quote[] } | undefined)?.quotes;

/**
 * Books an offer the way the app does (its reply); returns the hire once it's held. A price
 * locks for about 3 minutes: if it ran out (a slow network), book the same agent's fresh offer
 * once, as a person would.
 */
async function book(s: Session, chat: string, q: Quote) {
  let turn = await s.say(chat, q.reply);
  let card = turn.cards.find((c: Card) => c.type === "hire") as { hireId: string } | undefined;
  if (!card) {
    const agent = q.title.split(" · ").pop() ?? "";
    const fresh =
      quotesIn(turn.cards) ??
      quotesIn(
        (
          await s.say(
            chat,
            "That price expired. Get fresh prices for the same thing, just show them.",
          )
        ).cards,
      );
    const retry = fresh?.find((f) => f.title.endsWith(`· ${agent}`));
    if (retry) {
      turn = await s.say(chat, retry.reply);
      card = turn.cards.find((c: Card) => c.type === "hire") as { hireId: string } | undefined;
    }
  }
  check(
    `chat: booked ${q.title.slice(0, 40)}, held in escrow`,
    !!card,
    card ? "" : turn.words.slice(0, 160),
  );
  return card?.hireId;
}

/** Waits until it's delivered: a booking reference and an authorized card. */
async function delivered(s: Session, chat: string, id: string, what: string) {
  const h = await until(
    hireOf(s, chat, id),
    (h) => !!h && h.status !== "held" && h.status !== "paying",
    240,
  );
  check(
    `${what}: delivered, with a booking reference`,
    h?.status === "delivered" && !!h.bookingRef,
    `${h?.status} ${h?.bookingRef ?? ""}`,
  );
  check(
    `${what}: paid the supplier with a one-time card`,
    h?.card?.status === "authorized",
    `${h?.card?.status ?? "no card"} ${h?.card?.last4 ?? ""}`,
  );
  return h;
}

export async function hotelsAndFlights(
  s: Session,
  d: { hotelChat: string; flightChat: string; day: (n: number) => string },
) {
  const hotels = await offers(
    s,
    d.hotelChat,
    `Find me a hotel in Goa near Candolim for 1 adult, ${d.day(30)} to ${d.day(32)}. Just show the offers, don't book yet.`,
    "hotel",
  );
  // A larger fee (PriceGuard's) needs a real person's World ID approval: the card asks for it.
  const bigger = hotels.find((q) => q.title.endsWith("· PriceGuard"));
  if (bigger) {
    const turn = await s.say(d.hotelChat, bigger.reply);
    check(
      "chat: a larger fee asks for World ID first",
      turn.cards.some((c: Card) => c.type === "human"),
      turn.cards.map((c) => c.type).join(", ") || turn.words.slice(0, 120),
    );
  }
  const [first, other] = hotels.filter((q) => q.title.endsWith("· StayWise"));
  if (first) {
    const id = await book(s, d.hotelChat, first);
    if (id) {
      await s.expect("GET /chats/:id/hires", 200, "GET", `/chats/${d.hotelChat}/hires`);
      await s.expect("GET /chats/:id/limits", 200, "GET", `/chats/${d.hotelChat}/limits`);
      const undo = await s.expect(
        "POST /chats/:id/hires/:hireId/cancel (undo)",
        200,
        "POST",
        `/chats/${d.hotelChat}/hires/${id}/cancel`,
        {},
      );
      check(
        "undo: cancelled, nothing booked",
        undo.json?.status === "cancelled" ||
          (await hireOf(s, d.hotelChat, id)())?.status === "cancelled",
      );
    }
  }
  const second = other ?? first;
  const hotel = second ? await book(s, d.hotelChat, second) : undefined;
  if (hotel) {
    await delivered(s, d.hotelChat, hotel, "hotel");
    await s.expect("GET /receipts/:id", 200, "GET", `/receipts/${hotel}`);
    const trips = await s.expect("GET /trips", 200, "GET", "/trips");
    check("the booking shows in Trips", JSON.stringify(trips.json).includes(hotel));
    await s.expect(
      "GET /chats/:id/hires/:hireId/rating",
      200,
      "GET",
      `/chats/${d.hotelChat}/hires/${hotel}/rating`,
    );
    await s.expect(
      "POST /chats/:id/hires/:hireId/dispute",
      200,
      "POST",
      `/chats/${d.hotelChat}/hires/${hotel}/dispute`,
      { reason: "not_found" },
    );
    const h = await until(hireOf(s, d.hotelChat, hotel), (h) => h?.status === "refunded", 180);
    check("reported: cancelled at the hotel and refunded", h?.status === "refunded", h?.status);
    check("reported: the one-time card voided", h?.card?.status === "voided", h?.card?.status);
  }

  const flights = await offers(
    s,
    d.flightChat,
    `Find me a one-way flight from Mumbai (BOM) to Goa (GOI) on ${d.day(30)} for 1 adult. Just show the options, don't book yet.`,
    "flight",
  );
  const flight = flights[0] ? await book(s, d.flightChat, flights[0]) : undefined;
  if (flight) {
    await delivered(s, d.flightChat, flight, "flight");
    // Done at once, or (Hedera slow) "still cancelling": either way it must end up refunded.
    const c = await s.req("POST", `/chats/${d.flightChat}/hires/${flight}/cancel-booking`, {});
    check(
      "POST /chats/:id/hires/:hireId/cancel-booking",
      c.status === 200 || /still cancelling/.test(JSON.stringify(c.json)),
      `${c.status} ${JSON.stringify(c.json).slice(0, 120)}`,
    );
    const h = await until(hireOf(s, d.flightChat, flight), (h) => h?.status === "refunded", 300);
    // Inside the review window everything comes back (after it, the fee stays paid).
    check(
      "cancelled at the airline; in the review window, refunded",
      !!h?.bookingCancelledAt && h?.status === "refunded",
      h?.status,
    );
  }
}
