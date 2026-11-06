# Deploying Shikigami

Shikigami runs on an Oracle VM (Mumbai, ARM64, Ubuntu 24.04) through **Coolify**, as its own
Coolify project `shikigami`, at **https://heyshikigami.duckdns.org** (DuckDNS → the VM's IP;
Coolify's Traefik gets the HTTPS certificate from Let's Encrypt). The name `heyshikigami.eth`
points there too, once registered.

## What runs

`docker-compose.prod.yml`, one Coolify application:

| Service | Built from | What |
|---|---|---|
| `postgres` | postgres:17-alpine | The database (volume `pgdata`, never exposed) |
| `backend` | `deploy/Dockerfile.backend` | The API, the x402 facilitator and our four agents (StayWise, PriceGuard, SkyHop, Bank Check), started by `deploy/start-backend.sh` |
| `web` | `deploy/Dockerfile.web` | The Next.js app (the PWA); the public domain points here, port 3000 |

Each agent has a **public https address** on our domain: `https://heyshikigami.duckdns.org/a/staywise`
(and `/a/priceguard`, `/a/skyhop`, `/a/bankcheck`). The web app forwards `/a/<agent>/*` to the
agent inside the backend container (`AGENTS_HOST`), the agents list that address on Arkiv
(`STAYWISE_URL` etc.: a profile is published again whenever an agent's address changes) and
point their ERC-8004 cards at it. So the market review, other apps and anyone reading an agent's
card reach it like any third-party agent, over https. The agents' files (jobs, quotes,
ERC-8004 ids) are on the `agentdata` volume. A fresh volume is fine: each agent finds the
ERC-8004 identity its key already owns on Hedera instead of registering a second one.

## Settings (Coolify environment)

Every setting in `.env` except the local ones (`DATABASE_URL`, `PORT`, the World developer portal
key) is copied into Coolify's environment; values are never printed or committed. Also:
`APP_ORIGIN=https://heyshikigami.duckdns.org` (passkeys and sign-in are bound to it, so accounts
made on localhost don't carry over), and `SERVICE_PASSWORD_POSTGRES` (Coolify generates it).

## One copy at a time

The server uses the same agent keys, Hedera accounts and Telegram bot as local development. While
it runs, don't run the agents, the facilitator or the API locally: two copies would both renew
the agents' Arkiv listings, both work on the same jobs, and both poll Telegram (only one gets
each message).

## Deploying a change

Merge to `main`, then deploy in Coolify (or `POST /api/v1/deploy?uuid=<app uuid>` with an API
token). Builds run on the VM: a few minutes on its 2 ARM cores. Before switching over, top up HBAR
with `pnpm setup:testnet` and `pnpm --filter @app/agents agents-setup` (deliveries cost gas).
