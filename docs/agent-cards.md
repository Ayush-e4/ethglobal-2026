# Paying hotels and airlines: the trip price and agent cards

An agent's **fee** was always paid into escrow on Hedera. Now the **trip price** goes into the same
escrow too, and the agent pays the hotel or airline with a **one-time card** that only exists
because that money is held. Undo and Report protect the whole trip, not just the fee.

## The flow

1. **Quote.** The agent's offer carries `priceUnits`: the trip price at **testnet scale**
   (`TESTNET_SCALE`: ₹1 = 1 unit = 0.000001 test USDC, so a ₹11,633 stay is 0.011633 test USDC).
   Real prices don't fit testnet balances; the flow is the same.
2. **Pay.** Our API names the quote in an `x-quote` header. The agent's x402 terms ask for
   **fee + price** in exact USDC units (no rounding), and its `/book` checks that the escrow holds
   that much. The spending limit you approve with Face ID covers it (up to 0.20 a payment, 0.50 in
   a chat); older, smaller limits ask for a new one.
3. **Undo** (60 s): everything comes back, and no card was ever made.
4. **Card.** After the undo window, the agent asks **AgentNet Cards** for a card, signing with its
   own key. The issuer checks on Hedera that this job's escrow is held, for this agent, with at
   least the price. Then it issues a single-use virtual card: one merchant, the exact amount, an
   hour. The agent gets the (mock) number and code once and books with it. Nobody keeps them:
   the issuer, the agent and the job's page keep only the last 4 digits.
5. **Booked.** The card shows on your hire, your trip and the public receipt: "•••• 7645 · Park
   Inn · ₹11,633 · on hold".
6. **Review** (15 min): Report a problem → the agent cancels, refunds the escrow, the card is
   **voided**. Cancel the booking in this window → everything is refunded, fee included.
7. **Paid.** When Hedera releases the escrow to the agent, the card's charge is **captured**,
   settled from that escrow.

## What's simulated, and what's real

| | |
|---|---|
| Real | The escrow on Hedera (fee + price), the undo and review windows, refunds, the issuer's check of the escrow before any card exists, the agent's signatures |
| Simulated | The card network: card numbers are fake, nothing is charged, and the supplier's sandbox (LiteAPI, Duffel test mode) is paid from its test account as before. In production this is a card issuing partner (an agent-payments program such as Visa's or Mastercard's) |
| Scaled | Trip prices, so they fit testnet balances |

## Routes

| | |
|---|---|
| `POST /cards/issue` | An agent asks for its job's card (`escrowId`, merchant, amount, `amountUnits`, signed `cardMessage`). 409 if no escrow holds that price for it; the same card again on a retry (without the number) |
| `POST /cards/void` | The agent no longer needs it (signed `voidCardMessage`) |

The card's state follows the escrow (`src/cards/issuer.ts`): authorized → captured on payout,
→ voided on refund. Each change is mirrored on the hire.
