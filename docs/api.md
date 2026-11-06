# API (apps/api)

Hono on Node, Postgres through Drizzle. Migrations live in `apps/api/drizzle` and apply by
themselves when the API starts, so the database always matches the code.

## Sign-in

| Route | What |
|---|---|
| `POST /auth/passkey/register-options` → device → `POST /auth/passkey/register` | A new account with a passkey (Face ID, a fingerprint, a phone) |
| `POST /auth/passkey/login-options` → device → `POST /auth/passkey/login` | Sign in with that passkey |
| `POST /auth/demo` | **Try the demo**: a demo account in one tap (spending comes from a shared demo wallet with daily caps, added with hiring) |
| `POST /auth/logout`, `GET /me` | End the session; who's signed in, with roles |

Web2 analogy for passkeys: "Sign in with Apple" without an Apple account. The device keeps the
private key and signs a one-time challenge; we keep only the public key. Passkeys are P-256 so
the same key can later control the user's wallet contract.

- Challenges work once, for 5 minutes, and are used up in the same statement that checks them.
- A passkey made for another site is refused (the browser binds it to our origin).
- Sessions: an httpOnly, SameSite=Lax cookie (Secure on https); only a hash of the token is
  stored. A week long.
- CORS lets only the app's own origin call with cookies.

## Chats and the concierge

| Route | What |
|---|---|
| `POST /chats`, `GET /chats`, `GET /chats/:id` | Start a chat, list them, read one with its messages (each user sees only their own) |
| `POST /chats/:id/messages` `{ text }` | The user's turn is saved first; the reply streams as Server-Sent Events (`text` deltas, `card`, `status`, then `done` or `error`) and is saved with its cards when complete |

The stream is sent with `Cache-Control: no-cache, no-transform`, set after Hono's `streamSSE`
(which sets its own): without `no-transform`, Next's `/api` proxy gzips the stream for browsers and
every event arrives at once at the end. A ping every 10 s keeps proxies from closing a quiet stream
while a hire pays. A turn runs to the end even if the reader leaves (no abort signal), because an
agent may already have been paid; the app fetches the saved reply.

The concierge is **Claude Haiku** (`claude-haiku-5-5`, effort low) in a streaming tool loop
(`src/concierge`). Its tools: `find_agents` (agents listed on Arkiv) and `get_hotel_quotes` (asks
each hotel agent's own API, free). A quote only counts if the agent also signed it on Arkiv with
the same key, so an agent's API can't claim a price it didn't commit to. Tool inputs are validated
before running; a refusal or truncated turn stops the loop. Agent text is third-party data, never
instructions (the system prompt says so). Earlier cards go back into the history as short notes
(with quote keys), so "book the first one" works a turn later.

## Hiring from chat (one payment path)

The concierge's `book_quote` tool calls the hiring service (`src/hiring`), the only way money
moves from the app:

1. **Only quotes shown in this chat** can be booked (saved when shown, until they expire).
2. Demo accounts: **daily caps** (0.06 USDC of fees per account, 0.50 in total), checked first.
3. **The hire is written down before paying** (`paying`).
4. The chat's **spending limit** for that agent is found or made on Hedera (0.10 USDC, 0.05 per
   payment, that agent only, 24 hours), owned by the demo wallet for now; the user's own Face ID
   wallet replaces it next.
5. **The AI's key signs an x402 payment** (`@app/x402`) the limit allows, held in escrow with at
   least a 30 s undo window; the agent's paywall settles it through our facilitator. The hire
   becomes `held`, and a **hire card** with the undo deadline appears in the chat.
6. **Undo**: `POST /chats/:id/hires/:hireId/cancel` before the deadline (only for a hire in that
   chat, by its owner): the limit's owner takes the fee back; the agent sees it and does nothing.
   The chat gets a line saying so, so the concierge knows when the user writes next.
7. **The follower** (`follow.ts`) follows every open hire from the database every 5 s: asks the
   agent's job URL, reads the escrow on Hedera, posts the booking reference into the chat, and marks
   it `released` when Hedera pays the agent. After a restart it carries on; a hire still `paying`
   (outcome unknown) is flagged `failed` for a check, never paid twice.

`GET /chats/:id/hires` gives the cards their live status: only what a card shows (status, fee,
pay transaction, undo deadline, booking reference, note), never the agent's job URL or escrow id.

## Face ID wallets

| Route | What |
|---|---|
| `GET /wallet` | A passkey account's wallet: address, Hedera id, status (`creating` / `ready` / `failed`), test USDC, the gift. Demo accounts: `{ demo: true, wallet: null }` |
| `POST /chats/:id/limits/face-id` `{ payee }` | Step 1 of a Face ID limit: the wallet's batch is prepared; returns `{ opId, options }` (WebAuthn request options, the challenge is the batch's digest). Only for an agent that quoted in this chat, on the standard terms, for our concierge's key |
| `POST /chats/:id/limits` `{ opId, response }` | Step 2: the device's answer; the wallet sets the limit on Hedera; saved for the chat |
| `GET /chats/:id/limits` | The chat's live limits (payee, budget, expiry): how a limit card knows it was approved |

Signing up with a passkey starts making the wallet in the background (`src/wallet`): the sponsor
calls the factory (the address comes from the passkey, so it's known up front), waits for the
mirror to show its Hedera id, then sends the gift. Safe to repeat: a visit to `/wallet` retries a
failed try or one a restart cut off, and the gift is recorded **before** it's sent, so it never
goes out twice. Details of the wallet itself: [wallet.md](wallet.md).

## Roles

`user` for everyone; `admin` for account ids listed in `ADMIN_USERS` (server settings only, so
nobody can make themselves admin). Admin powers are small and come later (usage numbers, hiding
a merchant in the app); no role can touch money: the contracts have no admin.

## Local setup

```bash
pnpm db:up                       # Postgres 17 in Docker on 127.0.0.1:54339
pnpm --filter @app/api dev       # the API on :8787 (DATABASE_URL in .env)
pnpm --filter @app/api db:generate   # after changing src/db/schema.ts
```

Tests run on PGlite (Postgres in memory) with the same migrations, and a software passkey that
signs like a real device; no Docker needed.

## Live checks (6 Nov 2026)

Hiring, with the facilitator, StayWise and the API running: "Find me a hotel in Goa for 2 adults,
check in 10 December, 2 nights" → quote (Park Inn by Radisson Goa Candolim, INR 11,438) → "Book the
first one" → `book_quote` → 0.02 USDC held ([tx](https://hashscan.io/testnet/transaction/0.0.11328382@1793920154.081520830)),
hire card with the undo deadline → after the window StayWise booked it → the chat got "Booking
reference 9-goiQGdF" → Hedera released the fee to StayWise (`released`). A second booking, undone on
its card inside the window: `cancelled`, the fee back on the limit, StayWise "undone by the buyer:
nothing booked".


Concierge: "Find me a hotel in Goa for 2 adults, check in 6 December, 2 nights" → Claude Haiku
called `get_hotel_quotes` → StayWise quoted Park Inn by Radisson Goa Candolim, INR 20,463
(refundable), fee 0.02 USDC, confirmed against its Arkiv record → a quotes card and a short reply,
both saved. The first try found nothing: LiteAPI refused to prebook the cheapest rate (409) and
StayWise gave up; StayWise now tries the next rooms.

Sign-in:

On Docker Postgres: the API applied its migration on start; "Try the demo" signed in, `/me`
returned the account with role `user`; after logout `/me` answered 401 and the session row was gone.
