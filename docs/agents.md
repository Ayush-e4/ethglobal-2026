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
