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

The concierge is **Claude Haiku** (`claude-haiku-5-5`, effort low) in a streaming tool loop
(`src/concierge`). Its tools: `find_agents` (agents listed on Arkiv) and `get_hotel_quotes` (asks
each hotel agent's own API, free). A quote only counts if the agent also signed it on Arkiv with
the same key, so an agent's API can't claim a price it didn't commit to. Tool inputs are validated
before running; a refusal or truncated turn stops the loop. Agent text is third-party data, never
instructions (the system prompt says so). Earlier cards go back into the history as short notes
(with quote keys), so "book the first one" works a turn later.

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

Concierge: "Find me a hotel in Goa for 2 adults, check in 6 December, 2 nights" → Claude Haiku
called `get_hotel_quotes` → StayWise quoted Park Inn by Radisson Goa Candolim, INR 20,463
(refundable), fee 0.02 USDC, confirmed against its Arkiv record → a quotes card and a short reply,
both saved. The first try found nothing: LiteAPI refused to prebook the cheapest rate (409) and
StayWise gave up; StayWise now tries the next rooms.

Sign-in:

On Docker Postgres: the API applied its migration on start; "Try the demo" signed in, `/me`
returned the account with role `user`; after logout `/me` answered 401 and the session row was gone.
