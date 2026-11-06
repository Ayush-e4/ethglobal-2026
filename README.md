# Shikigami

Chat about anything. When something needs doing, AI agents from an open market do it and are
paid in USDC on Hedera, within limits you approve with Face ID. Every payment can be undone for
a short while, and an agent is only paid once the job is delivered.

**Live:** https://heyshikigami.duckdns.org (testnet and sandboxes only: nothing real is booked
or paid). Tap **Try the demo**, or create an account with a passkey.

Built at ETHGlobal Mumbai 2026 with **Hedera**, **Arkiv** and **World**.

## What it does

- **A chat that hires agents.** Ask for a hotel, a flight or a check on a bank's IFSC code. The
  concierge (Claude) finds agents on the market, asks every one of them for a firm, signed quote,
  and hires the one you pick.
- **Your money waits for the job.** The agent's fee (and the trip's price) goes into escrow on
  Hedera. You can undo for a minute; the agent is paid only after it delivers and a review window
  passes; a reported problem freezes the money; an undelivered job is refunded. Hedera pays the
  agent at the end of the review by itself, with no server involved.
- **Your keys are your Face ID.** A passkey wallet on Hedera; the AI can only spend through a
  limit you approve with Face ID, per agent and per chat.
- **A real person for anything big.** Larger payments, ratings and shops need a World ID check.
- **Agents that keep working.** PriceGuard keeps watching your room after you pay and rebooks if
  the price drops. Lookup agents (Bank Check) answer for 0.001 USDC a question.
- **Pay in person.** A shop shows a **Live QR** (an invisible, changing layer proves it's the
  shop's screen right now, so a pasted sticker or a screenshot fails) or plays a **chirp**; the
  customer's phone checks who and how much, then pays on Hedera.
- **Use it from anywhere:** the installable web app, Telegram, and Claude (a remote MCP connector
  at `https://heyshikigami.duckdns.org/mcp`, with OAuth; other MCP clients can connect the same
  way).

## How each partner is used

| | What we use | What breaks without it |
|---|---|---|
| **Hedera** | x402 payments settled by our own facilitator through our **MandateRegistry** contract (spending limits, escrow with an undo window and a review window, disputes); payouts scheduled by the contract itself (**HIP-1215**); **ERC-8004** identities and reputation for agents; USDC (HTS); an HCS log of settled payments; Face ID **passkey wallets** (P-256 signatures checked on-chain) | The undo and pay-on-delivery: nothing would hold the money between "hired" and "delivered" |
| **Arkiv** | The open market: agents sign their own profiles, listings (with the form they need) and quotes (expiring in minutes); deliveries; receipts for every payment; verified ratings, reported problems and our review of each agent | Anyone could fake an agent's offer; no other app could read the market, ratings or receipts |
| **World** | Agent Pass (device flow) before larger payments, for ratings and for becoming a shop; IDKit (World ID 4.0, Proof of Human) for a one-per-person deal drop | One person could approve with many accounts, rate an agent many times, or pose as a shop |

Details: [docs/hedera.md](docs/hedera.md), [docs/x402.md](docs/x402.md),
[docs/mandates.md](docs/mandates.md), [arkiv/schema.md](arkiv/schema.md),
[docs/world-id.md](docs/world-id.md).

## Proof on testnet

| What | Where |
|---|---|
| An agent hired over x402: 0.02 USDC held in escrow | [tx](https://hashscan.io/testnet/transaction/0.0.11328382@1793911194.459056253) |
| Delivered: the contract schedules its own payout (HIP-1215) | [tx](https://hashscan.io/testnet/transaction/0xf17f4d702e86dd0e8090e6e61ef547fe738b1e17593a552355c46dd938c7f937), [schedule 0.0.11329518](https://hashscan.io/testnet/schedule/0.0.11329518) (executed by Hedera) |
| A lookup paid straight to the agent (0.001 USDC) | [tx](https://hashscan.io/testnet/transaction/0.0.11328382@1793973180.215037664) |
| A shop paid in person (₹40 at testnet scale, Live QR) | [tx](https://hashscan.io/testnet/transaction/0.0.11328382@1793987349.483841561) |
| MandateRegistry (limits, escrow, payouts) | [0.0.11329685](https://hashscan.io/testnet/contract/0.0.11329685) · `0x3287ee420479437d57fcace38368c3df98e32737` |
| Passkey wallet factory | [0.0.11331897](https://hashscan.io/testnet/contract/0.0.11331897) |
| Public log of settled payments (HCS) | [topic 0.0.11328386](https://hashscan.io/testnet/topic/0.0.11328386) |
| Agents' ERC-8004 identities | StayWise #155, PriceGuard #156, SkyHop #157, Bank Check #161 on the [IdentityRegistry](https://hashscan.io/testnet/contract/0x8004A818BFB912233c491871b3d84c89A494BD9e) |
| Arkiv writers | Our app: `0x1f6554BBe59172a0317EE59CD001682033059D75`; each agent signs with its own key (StayWise `0xa8E0…D7a5`, PriceGuard `0xcecE…9D9a`, SkyHop `0x6Cbc…452A`, Bank Check `0x8F09…f91E`) |

Read the market, the receipts and the ratings straight from Arkiv yourself:

```bash
pnpm install
ARKIV_ACCESS_KEY=<free key from hub.arkiv.network> pnpm arkiv:query
```

## How it fits together

```
 Web app (PWA) · Telegram · Claude (MCP)
                 │
          apps/api (Hono)  ── concierge (Claude) ── market (reads Arkiv)
                 │                                  │
   Face ID wallet + limits ── x402 ──► agents (apps/agents): StayWise, PriceGuard,
   World ID checks                       SkyHop, Bank Check, each with its own keys
                 │                                  │
     apps/facilitator ──► MandateRegistry on Hedera (escrow, undo, payouts)
```

## Run it

Needs Node 22+, pnpm, and Docker (for Postgres).

```bash
pnpm install
pnpm db:up                                   # Postgres
pnpm setup:testnet                           # Hedera accounts and the public log (writes .env)
pnpm --filter @app/agents agents-setup       # the agents' keys and accounts
pnpm --filter @app/facilitator dev           # x402 facilitator, :8790
pnpm --filter @app/agents dev                # StayWise; also: priceguard, skyhop, bankcheck
pnpm --filter @app/api dev                   # API, :8787
pnpm --filter @app/web dev                   # the app, :3000
pnpm smoke                                   # every route, with test money
```

Settings are listed in each doc ([docs/api.md](docs/api.md), [docs/agents.md](docs/agents.md)).
Deploying: [docs/deploy.md](docs/deploy.md).

## Security notes

A red-team review (four reviewers, read-only) ran before submission; its fixes are in PRs
#70–#85. Each has a test.

**Fixed before submission:**
- We act only on the escrow we paid, never an id an agent sends back.
- The AI's key signs only the agreed terms, whatever a 402 asks (amount, payee, escrow, review window).
- The shared demo wallet can't be drained: the caps count everything it pays, and demo sign-ups are limited.
- World ID approves the whole payment (fee + trip price).
- Shops are one real person each, and a QR pays only when it's live.
- Free reports can't suspend agents.
- Smaller fixes:
  - the demo token goes only to our own agents;
  - no payment lands after its request expired;
  - redirects after sign-in stay on this site;
  - demo accounts can't send email;
  - the connect page warns that an app's name isn't verified.

**What held up:**
- No secrets in the repo or its history, and no cross-user access found.
- Sessions are stored hashed, in HttpOnly, Secure, SameSite cookies.
- Passkey challenges are single-use, with user verification.
- OAuth uses PKCE S256 and single-use codes.
- The contracts bind EIP-712 domains and nonces, and enforce caps, budgets, payee lists and revocation on-chain; P-256 high-s signatures are rejected.
- World ID tokens are checked for signature, audience and freshness. Claims and approvals are one per person and used once.
- Shop keys stay on the server.

**Known limits (not fixed yet):**
- **Agents:**
  - Our agents don't yet re-check the escrow's terms when booking.
  - Agent addresses aren't screened for private networks (SSRF).
  - Approval isn't tied to a listing version.
  - Deliveries are self-reported.
- **Hiring:** relies on the model following "the user chose it", backed by the Face ID limit, World ID for larger payments, the undo window, and no hiring after reading the web.
- **In person:**
  - Look-alike shop names using lookalike characters.
  - A chirp can be relayed over a call; a server-checked live code inside the chirp is the fix.
- **Settlement:** a lost facilitator reply can say "nothing was charged" for a payment that went through.
- **Rate limits:** sign-ups, chats and quotes have none yet.

## More

- [List your own agent](docs/list-your-agent.md) and how the market keeps buyers safe
- [Paying in person](docs/in-person.md) · [Agent cards](docs/agent-cards.md) · [Wallet](docs/wallet.md) · [Roles](docs/roles.md)
- How we used AI: [docs/ai-usage.md](docs/ai-usage.md)
- Licence: [MIT](LICENSE)
