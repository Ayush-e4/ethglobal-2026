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
| `/chat/[id]` | The conversation: replies stream in, with cards (agents, choices, quotes with **Choose**, and the **hire card**) |

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
- **Replies really stream**: the API marks the stream `no-transform`, or Next's proxy gzips it and
  the status line, cards and text all land at the end (caught while testing the hire card).
- **Long requests**: Next's proxy timeout is 5 minutes; the default 30 s made a booking look
  failed while its payment went through.

## An installable app (PWA)

Shikigami installs to a phone's home screen and opens in its own window: `src/app/manifest.ts`
(name, start at `/chat`, shortcuts to a new chat, Trips and Wallet), icons in `public/` (a
hitogata, the paper figure a shikigami lives in: regular, maskable for Android, and Apple's),
and `public/sw.js`. The service worker only keeps a small "you're offline" page: chats, money and
sign-in always go to the network, never a stale copy. Chrome and Android show **Install the app**
in the sidebar (their install prompt); on an iPhone it explains Share → Add to Home Screen.
Installing needs https (any deployed address; on this machine, localhost).

## Feels like an app on a phone

What an installed web app can do on iPhones and Android today, used where it helps:

| Native thing | Where | How |
|---|---|---|
| Tab bar, Back below a tab | Chat, Trips, Pay, Get paid, Wallet; a chat thread | `shell/TabBar.tsx`, `shell/AppShell.tsx` |
| Back closes what's on top first | The drawer, Pay's scanner, Get paid's QR | One history entry per open layer (`lib/native/back.ts`) |
| Page slides | Tabs rise in; a chat slides in from the right | React `<ViewTransition>` with typed navigations (`tab`, `nav-forward`, `nav-back`) |
| Haptics | Tabs, payment success and failure | Vibration API on Android; a tap tick on iOS 18+ (`lib/native/haptics.ts`) |
| Screen stays on | While a shop shows its QR | Screen Wake Lock (Android; iPhones from iOS 18.4) |
| Share sheet | Receipts | Web Share (copies the link where there's none) |
| Install | A card on the chat home on phones | Chrome's prompt; Safari's two steps |

Motion: a WebGL2 burst and a coin-flip tick when money lands (`lib/native/celebrate.ts`,
`SuccessMark.tsx`); a WebGL orb that follows the microphone while listening for a chirp
(`inperson/ListenOrb.tsx`); GSAP for lists that rise in, new messages, the undo ring and the
sliding tab highlight (`lib/native/motion.ts`). Placeholders shimmer while loading, a slow
payment says what Hedera is doing, and an offline bar explains a stalled screen. Reduced motion
(a phone setting) turns all of it off.

Not used yet: push notifications and app-icon badges (installed apps on both, iOS 16.4+): they
need a server side (subscriptions, signing keys); Telegram alerts cover it for now.

## The hire card

After **Choose**, the concierge hires the agent and the chat shows its card, which follows the hire
live (`GET /chats/:id/hires` every 3 s, stopping once it's finished):

| Pill | Steps |
|---|---|
| **can undo** | fee held on Hedera, not paid yet (links the transaction on HashScan) · the agent books when the undo window ends · **Undo · 0:45 left** |
| booking… | the agent is booking it |
| booked | Booked · reference … · Hedera pays the agent when the review window ends |
| done · paid | Hedera paid the agent the fee (no one pressed anything: a scheduled call on Hedera) |
| undone · nothing paid | Undone: nothing booked, the fee is back on your limit |
| refunded / didn't go through | the agent refunded, or the payment failed (with the reason) |

**Undo works from any card**, not only the latest reply's: the window is short, and the concierge
may still be writing when you want out. A late tap gets the server's reason ("Too late to undo").

## Checked in the browser (6 Nov 2026)

Signed out → `/login` → Try the demo → chat home → "Find me a hotel in Goa for 2 adults, check
in 12 December, 2 nights" → the reply streamed with a quote card (Park Inn by Radisson Goa
Candolim, ₹12,914, fee 0.02 USDC paid on delivery). No console errors. On a phone (375 px) the
**Choose** button wrapped onto two lines; it now keeps its width.

Hire card (6 Nov 2026): Choose → card with a 0:50 countdown → **Undo** → "undone · nothing paid"
and a line in the chat. Hired again and let it run: booked (sandbox reference nZVtDFuGh) → after
the 2-minute review **done · paid**, by Hedera's scheduled call. Phone (375 px) checked.
