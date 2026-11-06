# Agents

## StayWise (hotels)

StayWise books hotel rooms in India through LiteAPI's **sandbox** (simulated bookings: nobody is
charged, no hotel is told). It is an x402 merchant: the AI pays its fee into escrow, and
StayWise only books once the undo window is over.

| Route | Cost | What it does |
|---|---|---|
| `GET /quote?task&iata&checkin&checkout&adults` | free | Cheapest refundable room near the airport, price locked with a prebook, a firm quote posted on Arkiv (gone in 3 minutes) |
| `POST /book` `{ quote, guest }` | 0.02 USDC over x402 | The fee is held in the registry (60 s undo window, delivery within 30 min, 2-minute review). A bad or expired quote is refused **before** anything is paid |
| `GET /jobs/:escrowId` | free | Held → booking → delivered (with the booking reference), or cancelled / refunded |

How a booking goes:

1. After the undo window StayWise checks the money is still held. If the user undid it, it does
   nothing (`cancelled`).
2. It books the prebooked room with a **test traveller** (never real people's details).
3. It marks the escrow delivered on Hedera with a hash of the booking reference; the registry
   then schedules its own payout, so Hedera pays StayWise when the review ends.
4. It records the delivery on Arkiv. If the booking fails, it refunds the fee instead.

Jobs are kept in a small file (`apps/agents/.data`, not in git) and resumed after a restart. A
booking cut off mid-way is flagged for a check, never booked twice; a booked job whose delivery
mark failed is finished without booking again.

On start StayWise lists itself on Arkiv (profile + listing) if it isn't already.

A rate can sell out between search and prebook (LiteAPI answers 409); StayWise then tries the next
cheapest rooms (up to four) before saying there's nothing.

### Who controls what

| Who | Can | Can't |
|---|---|---|
| StayWise (`STAYWISE_PRIVATE_KEY`: its Hedera account alias and Arkiv writer) | Quote, book after the window, mark delivered, refund, write its own Arkiv records | Take the fee early, or at all if the user undid it or disputes; book before the window ends |
| The AI | Pay the fee within its limit | Pay more than quoted, or shorten the window |
| The user | Undo in the window; dispute in the review | |

### Run it

```bash
pnpm --filter @app/agents agents-setup   # StayWise's accounts (once)
pnpm --filter @app/facilitator dev       # the x402 facilitator, :8790
pnpm --filter @app/agents dev            # StayWise, :8801
pnpm --filter @app/agents demo           # live end to end (runs both itself)
```

### Live test (6 Nov 2026)

| Step | Result |
|---|---|
| StayWise lists itself on Arkiv | ✅ |
| Quote: Park Inn by Radisson Goa Candolim, 2 nights, INR 11,795, fee 0.02 USDC, on Arkiv | ✅ |
| The AI books it over x402: fee held in escrow | ✅ |
| After the 60 s window StayWise books it on LiteAPI's sandbox | ✅ booking `uw4P2UqWj` |
| Marked delivered on Hedera | ✅ [tx](https://hashscan.io/testnet/transaction/0x509058c7268f713409c7917eb8caa172b8b4c9d4abab014861c9becaf1022917) |
| A second booking undone inside the window | ✅ `cancelled`, nothing booked, the fee back on the limit |
| Hedera pays StayWise when the review ends, nobody calling | ✅ escrow `released`; StayWise holds 0.02 USDC |

**Reported problems.** Our hotel agents' terms give the buyer 15 minutes after delivery to report
a problem (`reviewSeconds` 900) before Hedera pays them. `POST /jobs/:id/dispute` acts only if
Hedera says the escrow really is disputed (only the buyer can do that, so nobody else can get a
guest's booking cancelled): it cancels the hotel booking (every room we sell is refundable), stops
any price watch, and refunds the fee. Our policy: a buyer's report is enough.

**Cancelling a booked stay.** `POST /jobs/:id/cancel-booking` `{ signature }` cancels the hotel
booking when the signature over `AgentNet: cancel the booking for job <escrowId>` comes from the
job's buyer on Hedera (the limit's owner or its AI key), so nobody else can cancel a guest's stay.
It keeps the fee (the job was done) and stops any price watch.

## SkyHop (flights)

SkyHop books economy flights for one passenger, one way or return, at most one stop, on
**Duffel in test mode** (`DUFFEL_ACCESS_TOKEN` must start with `duffel_test_`: orders go to test
airlines and are paid from Duffel's test balance; nobody is charged, no seat is taken). Skill
`flights`, fee 0.03 USDC, port 8803, its own Hedera account and Arkiv writer
(`SKYHOP_PRIVATE_KEY`, `SKYHOP_ACCOUNT_ID`, made by `agents-setup`).

- **Quote** (`GET /quote?task&from&to&date&returnDate?`, free): searches Duffel and offers three
  different flights, each for a reason: the cheapest, the fastest, and the most flexible
  (refundable or changeable), or another departure time when none is flexible. All three are
  posted on Arkiv in one transaction, expiring in 3 minutes.
- **Prices in rupees**: Duffel's test account prices in GBP, so offers show the fare in rupees at
  today's rate (open.er-api.com, kept 6 hours), with the GBP fare it's charged in alongside.
- **Book** (`POST /book`, the fee over x402 into escrow): refused before payment (422) if the
  traveller has no date of birth or gender. After the undo window it re-checks the fare and books
  only if it hasn't gone up by more than 2%; the guest gets the airline's booking code.
- **Cancel, report**: the same as every agent (below): a reported problem cancels the order and
  refunds the fee; a cancel after booking keeps the fee.

Run it: `pnpm --filter @app/agents skyhop`.

**Shared by every agent** (`src/jobs`): the paid routes (book, follow a job, cancel afterwards,
report a problem) and the worker that waits out the undo window, books with the agent's supplier
(LiteAPI for hotels, Duffel for flights), marks it delivered on Hedera and Arkiv, and refunds if
the booking fails.

**Trip prices and cards.** An offer's `priceUnits` (the trip price at testnet scale) is paid into
the same escrow as the fee, and the agent pays the hotel or airline with a one-time card from
AgentNet Cards (mock). See [agent-cards.md](agent-cards.md).

**Identity (ERC-8004).** Each agent registers itself in ERC-8004's IdentityRegistry on Hedera
with its own key and serves its card at `GET /.well-known/agent-card.json` (`src/identity.ts`;
the id is kept in `.data/<agent>-erc8004.json`). See [hedera.md](hedera.md).

## The market's protocol (any agent)

The concierge has no agent-specific code: it uses four generic tools, and an agent joins the
market by following this protocol (`packages/shared/src/market.ts`):

1. **List on Arkiv**: a profile (name, skill, endpoint, Hedera account) and a listing with its fee
   and its **form**, a small JSON Schema of what it needs to quote: fields of type string,
   integer, number or boolean, with `required`, `enum`, `minimum` / `maximum`, `maxLength`, and a
   `format` from our list (`date`, `iata`, `country`, `email`). Agents can't send their own
   regular expressions: a form is third-party input, and a slow pattern could hang the server.
   To change the form, publish a new listing: the newest one per agent counts.
2. **`GET /quote?task=…&<fields>`**: free. Answers `{ offers: [...] }`, up to 5, each a firm price
   also posted as a quote on Arkiv under the same `task` (that's what makes it count): key,
   title, subtitle, a one-line summary (it becomes the hire's title), fee, price, refundable,
   rating, location, up to 4 https images, details.
3. **`POST /book`**: paid over x402 into escrow, with an undo window; deliver, then get paid by
   Hedera after the review window (see above).

**The concierge holds no domain knowledge.** Everything about a job comes from the agents'
listings: what each field means and examples of it (`examples`, so "GOI" is StayWise's to teach,
not ours), and **how each agent works** (`service`: a model name like "Book it, done", a
one-line promise, and what it keeps doing afterwards). These are structured, length-limited data
that reach Claude as tool results, never in its instructions, so an agent can describe itself but
can't steer the concierge. A promise is the agent's claim; its record on Arkiv is the evidence.

**At market scale:** `find_agents(need)` searches by need in plain words over every agent's
skill, listing, service and description (so Claude needn't know skill names), returning the best
few; `get_quotes` asks at most the **top 10** agents for a job, most delivered jobs first (their
own delivery records on Arkiv, one query), then the lower fee. Agents with a skill share one form,
so forty hotel agents still mean one form for Claude.

The concierge: `find_agents(need or skill)` → `agent_input(skill)` (the forms, from Arkiv) → asks the user
for what's missing → `get_quotes(skill, input)` (each agent's form is checked first; offers not
signed on Arkiv are dropped; ranked cheapest first, then by fee) → `hire(quote)`.

## StayWise's search

Up to **three different hotels, each here for a reason**: the **cheapest**, the **best rated**
(guests' score) and the **best value** (score for the price), all refundable. Its form also
takes an optional **area** ("Baga Beach, Goa": found with LiteAPI's places search, then hotels
around it), a **budget** for the whole stay (INR) and **minimum stars**.

- Each price is **locked with a prebook**, all three at once; a sold-out rate gives its slot to
  the next hotel, and the labels are then re-worked so "Cheapest" is the cheapest shown.
- Each offer shows: 3–4 **photos** (https, from LiteAPI's hotel data), stars, guests' score and
  reviews, the area (the street only if short), room and meal plan, and up to three facilities
  as clean labels (Pool, Spa, Beach, Free WiFi…; "Pool hoist on site" counts as Pool).
- The three quotes go on Arkiv **in one transaction**.

Live (6 Nov 2026, sandbox): Goa, 20–22 Dec, 2 adults → Park Inn Candolim ₹11,927 with breakfast
(Cheapest, 8.7), Fairfield by Marriott Calangute ₹22,321 (Best value, 9.4), The Westin Goa
₹58,666 (Best rated, 9.8, near Baga), in about 15 s. "5 star under ₹40,000" → Holiday Inn
Candolim, Heritage Village, Hilton Candolim.

## PriceGuard: "Book and keep watching"

The second hotel agent: the same code as StayWise (`apps/agents/src/hotels`, one identity each:
its own key, Hedera account and listing), fee **0.05 USDC**, and a promise in its listing: it books
a firm, refundable room, then keeps checking that room's price until check-in, and if it gets
cheaper, rebooks it and the difference goes back to the guest.

- After delivery its **watch** starts: every `WATCH_EVERY_SECONDS` it re-checks the same hotel's
  live rate for the same room. A rebook must be worth it (at least ₹200 and 2%). It **books the
  cheaper rate first** (the guest is never without a room), then cancels the old booking
  (refundable: refunded in full); if the old one won't cancel, it cancels the new one instead, so
  the guest never holds two.
- Its job keeps going **after Hedera pays it**: the API follows watching hires, posts each rebook
  in the chat once ("₹11,927 → ₹11,127, so ₹800 comes back to you. New booking reference …"),
  and the hire card shows "Saved ₹800 · 1 rebook · watching the price until 20 Dec".
- **Demo:** sandbox prices don't move, so with `DEMO_TOKEN` set a watching hire's card has
  "Simulate a price drop (demo)": the next check sees the room ₹800 cheaper. The rebook and the
  cancellation are real sandbox operations; the chat says the drop was simulated.

Live (6 Nov 2026): "Hotel in Goa, 20–22 Dec, and I'd like the price watched" → six offers, the
same hotels from both agents; the concierge explained the two models and recommended PriceGuard.
Hired → booked pPaf1ZKXZ → demo drop → rebooked jvSE0la7Q (old one cancelled), ₹800 saved, told
in the chat. An earlier PriceGuard hire was paid out by Hedera and kept watching.
