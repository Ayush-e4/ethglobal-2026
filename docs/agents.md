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

The concierge: `find_agents(skill)` → `agent_input(skill)` (the forms, from Arkiv) → asks the user
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
