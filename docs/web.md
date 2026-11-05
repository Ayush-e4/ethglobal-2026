# Web app (apps/web)

Next.js 16 + Tailwind 4, phone first. The browser only talks to the web app: `/api/*` is
forwarded to the API (`API_URL`, default `http://localhost:8787`), so the session cookie stays
first-party (no CORS).

## Run it

```bash
pnpm db:up                                   # Postgres
pnpm --filter @app/facilitator dev           # x402 facilitator :8790
pnpm --filter @app/agents dev                # StayWise :8801
pnpm --filter @app/api dev                   # API :8787
pnpm --filter @app/web dev                   # app http://localhost:3000
```

## Screens so far

| Route | What |
|---|---|
| `/login` | Create an account with a passkey (Face ID, fingerprint, phone), sign in with it, or **Try the demo** |
| `/chat` | Chat home: greeting, composer, suggestions. Sending starts a chat and opens it |
| `/chat/[id]` | The conversation: replies stream in, with cards (agents, choices, quotes with **Choose**) |

Signed-out visitors go to `/login` (`src/proxy.ts`: a cookie-presence check only; the API checks
every request). After sign-in, `?next=` only ever leads to a path inside the app.

## Built in from the start (fixes from our practice project)

The screens come from the practice project's final, already-fixed version, built up step by step:

- **Phone-first shell**: a slim top bar and a drawer on phones; on desktop the sidebar stays put
  while the page scrolls, and only recent chats scroll inside it.
- **Composer**: a soft focus ring (not the square global outline), grows as you type, Enter makes
  a new line on phones (the button sends), 16 px text so iOS doesn't zoom, safe-area padding.
- **Messages**: no avatar beside replies (one left edge for replies, cards and composer); long ids
  wrap instead of widening the page; the chat header stays pinned.
- **Model text** is rendered from a small Markdown subset as React elements, never raw HTML.
- **Only the latest reply's cards** can be acted on.
- **A dropped stream doesn't lose the reply**: the app fetches the saved conversation until it shows.
- **Chats refresh every 6 s while open and idle**, so a delivery the server posts later appears.
- **Long requests**: Next's proxy timeout is 5 minutes; the default 30 s made a booking look
  failed while its payment went through.

## Checked in the browser (6 Nov 2026)

Signed out → `/login` → Try the demo → chat home → "Find me a hotel in Goa for 2 adults, check
in 12 December, 2 nights" → the reply streamed with a quote card (Park Inn by Radisson Goa
Candolim, ₹12,914, fee 0.02 USDC paid on delivery). No console errors. On a phone (375 px) the
**Choose** button wrapped onto two lines; it now keeps its width.
