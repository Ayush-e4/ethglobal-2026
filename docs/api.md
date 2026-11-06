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
(`src/concierge`). Its tools are the market's, generic: `find_agents`, `agent_input` (the form
agents with a skill need, from Arkiv), `get_quotes` (offers from every such agent, free) and
`hire` ([agents.md](agents.md#the-markets-protocol-any-agent)). A quote only counts if the agent also signed it on Arkiv with
the same key, so an agent's API can't claim a price it didn't commit to. Tool inputs are validated
before running; a refusal or truncated turn stops the loop. Claude sees earlier cards only as notes in the history (`chats/history.ts`), so each note carries every fact its card showed: with a fact missing, Claude once "corrected" a true earlier reply. Agent text is third-party data, never
instructions (the system prompt says so). Earlier cards go back into the history as short notes
(with quote keys), so "book the first one" works a turn later.

## Hiring from chat (one payment path)

The concierge's `hire` tool calls the hiring service (`src/hiring`), the only way money
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
8. **Report a problem**: `POST /chats/:id/hires/:hireId/dispute` `{ reason: not_found | wrong_details | other }`,
   after delivery and within the review window (15 minutes; `reviewUntil`, `canReport` on the hire).
   The fee freezes on Hedera (`dispute`, signed by the concierge's key, a buyer on every limit: no
   Face ID), the dispute goes on Arkiv (written by us, so an agent can't hide it), the chat says
   so, and the agent is told. Our agents settle it by cancelling the hotel booking and refunding
   their fee; the follower then says so in the chat. An agent that ignores it is never paid. In
   Telegram, the hire's live message has **⚠️ Report a problem** for the same thing.

`GET /chats/:id/hires` gives the cards their live status: only what a card shows (status, fee,
pay transaction, undo deadline, booking reference, note), never the agent's job URL or escrow id.

Passkeys ask for **required** user verification (Face ID, a fingerprint, a PIN), at sign-up and
sign-in. With "preferred", a passkey app (a password-manager extension, in our first real-device
test) may skip it, and the server refuses the answer; the wallet contract only accepts verified
answers anyway. A refused answer's reason is logged (`auth: refused …`) and returned, so a
failed sign-up can be told apart.

## Face ID wallets

| Route | What |
|---|---|
| `GET /wallet` | A passkey account's wallet: address, Hedera id, status (`creating` / `ready` / `failed`), test USDC, the gift. Demo accounts: `{ demo: true, wallet: null }` |
| `POST /chats/:id/limits/face-id` `{ payee }` | Step 1 of a Face ID limit: the wallet's batch is prepared; returns `{ opId, options }` (WebAuthn request options, the challenge is the batch's digest). Only for an agent that quoted in this chat, on the standard terms, for our concierge's key |
| `POST /chats/:id/limits` `{ opId, response }` | Step 2: the device's answer; the wallet sets the limit on Hedera; saved for the chat |
| `GET /chats/:id/limits` | The chat's live limits (payee, budget, expiry): how a limit card knows it was approved |
| `GET /wallet/limits` | Your Face ID wallet's limits: agent, chat, budget, what's left (from Hedera), expiry, `active` / `expired` / `cancelled` |
| `POST /wallet/limits/:id/revoke/face-id` → device → `POST /wallet/limits/:id/revoke` `{ opId, response }` | Cancel a limit with Face ID: the wallet revokes it on Hedera |
| `GET /account/devices`, `POST /account/devices/link` | Your devices (passkeys), and a one-time code for adding one |
| `POST /auth/passkey/link/options` `{ code }` → new device → `POST /auth/passkey/link` | The new device makes its own passkey on the account and is signed in |
| `POST /account/devices/:id/wallet/face-id` `{ action: add \| remove }` → trusted device → `POST /account/devices/:id/wallet` | Let a device approve payments, or shut it out (Face ID on a device the wallet trusts) |
| `DELETE /account/devices/:id` | Forget a passkey that can't approve payments |

Signing up with a passkey starts making the wallet in the background (`src/wallet`): the sponsor
calls the factory (the address comes from the passkey, so it's known up front), waits for the
mirror to show its Hedera id, then sends the gift. Safe to repeat: a visit to `/wallet` retries a
failed try or one a restart cut off, and the gift is recorded **before** it's sent, so it never
goes out twice. Details of the wallet itself: [wallet.md](wallet.md).

## World ID

| Route | |
|-------|--|
| `GET /world` | World ID on this account: `available` (set up on this server), `verified`, the welcome `bonus` (`sending` / `sent` / `failed`, with its transaction), and the newest bonus `check` |
| `POST /world/bonus` | Start a World ID check that sends the bonus when it passes: `{ check: { id, status, userCode, link, expiresAt } }`. One at a time (a waiting check is returned again). 409 for demo accounts, a wallet that isn't ready, or a bonus already had |
| `POST /chats/:id/human-checks` `{ quoteKey }` | Start a World ID approval for a larger hire (fee from `WORLD_CHECK_FEE_USDC`): one payment to that quote's agent, at its fee, in this chat, within 10 minutes. The quote may have expired. 404 for a quote that isn't in your chat, 409 for one that needs no approval |
| `GET /chats/:id/human-checks/:quoteKey` | The newest approval check for that agent and fee in this chat (a reopened card) |
| `GET /world/checks/:id` | One of your checks: `waiting` / `verified` / `denied` / `expired` / `failed` / `mismatch`, and `used` |
| `GET /chats/:id/hires/:hireId/rating` | Can this hire's agent be rated (job done), is the account verified, and its rating of that agent (`score`, `posting` / `posted` / `failed`, its Arkiv entity) |
| `POST /chats/:id/hires/:hireId/rating` `{ score }` | Rate 1–5: posted at once for an account with a linked World ID (`{ rating }`), otherwise a World ID check starts and the rating is posted when it passes (`{ check }`)|

How a check is judged, and what's stored: [world-id.md](world-id.md).

## Travellers (who a booking is for)

| Route | |
|-------|--|
| `GET /travellers`, `POST /travellers` | Your saved travellers (up to 5: first and last name, email, phone, "me"), and adding one |
| `PATCH /travellers/:id`, `DELETE /travellers/:id` | Change one, or remove one (a chat booking for them asks again) |
| `GET /chats/:id/traveller`, `POST /chats/:id/traveller` `{ travellerId }` | Who this chat's bookings are for |

Before paying, hiring asks who it's for (`src/travellers`): if the chat has no traveller yet,
nothing is paid and the chat shows **Who is this booking for?** (saved travellers as buttons, or a
form for someone new, saved for next time). Once one is chosen, the booking carries on; the
order is: who it's for, then the World ID approval (larger fees), then the Face ID limit (your own
wallet), then the payment. **Who keeps the details:** we do, on the account. A booking sends the
chosen guest only to the agent it pays (and on to the hotel), never to Arkiv, and never to the
concierge's model: the card holds no details, and in Telegram the guest's reply is caught before
it reaches the concierge. Each hire keeps the guest's name and email for its receipt and
confirmation.

**Confirmation emails** (`src/email`, Resend): when the hotel confirms a booking, the guest gets
an email with the stay, the booking reference, their name, the agent, its fee (with the Hedera
payment) and a link to the chat; when PriceGuard rebooks it cheaper, another with the new
reference and what comes back. Both say it's a sandbox booking. Off without `RESEND_API_KEY`;
until a domain is verified at Resend, it delivers only to the Resend account's own email.

## Phone alerts (Telegram)

| Route | |
|-------|--|
| `GET /alerts` | `{ available, linked }`: is Telegram set up on this server, and is your Telegram chat connected |
| `POST /alerts/telegram` | A one-time link to our bot (`https://t.me/<bot>?start=<code>`); tapping **Start** there connects that Telegram chat to your account |
| `POST /alerts/test` | Sends a test alert: `{ sent }` |
| `DELETE /alerts/telegram` | Disconnect (in Telegram, `/stop` does the same) |

Whenever the app writes in a chat by itself (booked, with the reference; refunded; a cheaper
rebook by PriceGuard), the chat's owner gets that message in Telegram too, with a link back to the
chat (`src/alerts`). The chat message is the record; the alert is a nudge, sent best effort.

- **Each hire, live** (`src/alerts/live-hires.ts`): one Telegram message per hire, with the
  hotel's photo, edited in place as it moves on (fee held, with **↩ Undo** in red until the
  window ends → booked, with the reference → paid out → rebooked cheaper → rated). Booked and
  paid-out hires get **1★–5★** buttons (a verified person's rating, as on the web: only with the
  account's linked World ID), and every hire a **Payment** button (HashScan). Buttons work only
  from the Telegram chat the hire's owner linked. Edits are silent; the chat's own messages are
  the alerts that buzz.
- **Commands** (`src/alerts/commands.ts`): the bot sets its menu (`/status`: the account's
  latest bookings and price watches; `/help`; `/stop`) and what people see before tapping Start.
- **The concierge in Telegram** (`src/alerts/telegram-chat.ts`): a connected Telegram chat talks to
  one AgentNet chat, with the same turns, tools and payments as the web, saved in that chat (so the
  web shows it too; `/new` starts another). The reply streams in as a draft (`sendMessageDraft`:
  "Thinking…", the tool being used, then the text as it's written) and is then sent for good, in
  Telegram's HTML. Offers are one carousel message: a hotel with its photo and details, **◀ ▶**
  between hotels, **📷** between that hotel's photos (up to 4), and a **Book** button per agent
  offering it ("StayWise: Book it, done · 0.02 USDC", "PriceGuard: Book and keep watching · 0.05
  USDC"), all edited in place; the concierge's pick comes after it. Choices are buttons. A World ID approval opens from a button, and once it passes the booking
  carries on in Telegram. A spending limit needs Face ID, so it points to that chat on the web;
  approved there, the booking carries on and its live message arrives in Telegram.
- **One thread per person.** A Telegram bot has one chat with each Telegram user, so alerts from
  all of an account's chats arrive in that one thread, each titled with its chat. One Telegram chat
  is connected to one account: connecting it to another account moves it.
- **Its own bot.** The server reads the bot's messages by long polling (no public address needed),
  and only one server may read a bot's messages, so each deployment needs its own bot from
  @BotFather (`TELEGRAM_BOT_TOKEN`). Without one, alerts are off and the Wallet page doesn't show
  them.

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
