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

## Live check (6 Nov 2026)

On Docker Postgres: the API applied its migration on start; "Try the demo" signed in, `/me`
returned the account with role `user`; after logout `/me` answered 401 and the session row was gone.
