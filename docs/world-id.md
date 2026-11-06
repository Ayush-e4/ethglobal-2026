# World ID (apps/api/src/world)

World ID proves someone is a real, unique person without telling us who they are: no name, no
email. Each person gets one ID for our app (`sub`), always the same. Web2 analogy: "Sign in with
Google", except it answers only "is this one real person, and the same one as before?".

We use World's **Agent Pass** (OpenID Connect, device flow) for:

- **A welcome bonus, once per person.** Prove you're a person and your Face ID wallet gets
  +0.20 test USDC from our sponsor. The sign-up gift (0.10) needs nothing, so nobody is blocked.
- **A human checkpoint before larger payments.** Hiring an agent whose fee is 0.05 USDC or more
  (PriceGuard) needs a fresh approval in the World ID app, so a bot, a stolen session or a
  confused model can't make larger payments alone. Declined or timed out: nothing is paid.
  Smaller hires (StayWise, 0.02) go ahead as before, so nobody without World ID is stuck.

## How a check works

1. The Wallet page asks for the bonus: `POST /world/bonus`. Our server asks World to start a
   check and gets back a **device code** (kept on our server, never sent to the browser), a
   short **user code** and a link to World's page for this check.
2. The page shows the user code with a QR code of the link (laptop) or an **Open World ID** button
   (phone). World's page opens the World ID app; the person checks the code matches and approves.
3. Our server polls World until the person approves, declines, or time runs out (10 minutes).
4. On approval, World returns a signed ID token. Our server checks it: World's signature,
   issuer, that it's for our app (audience), not expired, a level that means one real person
   (Orb or Selfie Check), and **fresh**: approved after this check started, not an old session.
5. The World ID is **linked** to the account: one World ID per account, one account per World ID.
   A second account with the same World ID is refused.
6. The bonus is **recorded before it's sent** (keyed by the World ID, so never twice), then the
   sponsor sends it. At most `WORLD_BONUSES_PER_DAY` a day across everyone, so the sponsor can't
   be drained.

Anything else unlocks nothing: declined, timed out, World unavailable, a token that fails a
check, or a World ID already used by another account. The page says which, and nothing is sent.
Checks are kept in the database; after a restart the server picks up the ones still waiting.

## Approving a larger hire

1. The concierge calls `hire`; hiring asks the checkpoint first (`world/checkpoint.ts`). No
   approval yet: nothing is paid, and the chat shows a **Confirm it's you with World ID** card.
2. The card starts a check (`POST /chats/:id/human-checks`), shown like the bonus's: code, QR or
   button, waiting. Our server judges World's answer the same way (signature, audience, level,
   freshness); a passkey account's World ID must be the one linked to it. Demo accounts are
   throwaway, so nothing is linked to them: any verified person can approve there.
3. Approved: the card sends the booking again. What's approved is **one payment to that agent, at
   that fee, in that chat, within 10 minutes**: not the quote itself, since quotes last 3
   minutes and a fresh one from the same agent must still count.
4. The approval is used up only when the payment goes ahead, so a Face ID limit step in between
   doesn't cost a second World ID check; two hires at once can't both use it.

## What people need

Our hackathon build uses World's **sandbox** (`WORLD_ID_ISSUER=https://sandbox.auth.world.org`;
its page says "Uses fake identities"). We approve with World's **sandbox World ID app** (from
TestFlight, with a test identity). Whether the public World ID app
([App Store](https://apps.apple.com/app/id6760839426),
[Google Play](https://play.google.com/store/apps/details?id=org.world.id)) also approves sandbox
checks is not confirmed yet: we've asked World. World's page also offers "Continue with a
passkey", but only for a World ID that already has a passkey; it doesn't make a new one.

- **Laptop:** scan the QR code on our card with your phone (or open World's page).
- **Phone or tablet only:** tap **Open World ID**, then **Continue with World ID** and **Open World
  ID app** on World's page.
- Either way: approve in the app, then **go back to World's page**. That finishes the check: until
  the page is open again, our server's polls see "pending".

## Settings (.env)

| Name | |
|------|--|
| `WORLD_ID_ISSUER` | `https://sandbox.auth.world.org` for the hackathon (default: `https://auth.world.org`) |
| `WORLD_ID_CLIENT_ID`, `WORLD_ID_CLIENT_SECRET` | From World's developer portal (Agent Pass app). Without them, World ID is off and the page doesn't show it |
| `WORLD_BONUS_USDC` | The bonus (default 0.20) |
| `WORLD_BONUSES_PER_DAY` | Across everyone (default 20) |
| `WORLD_CHECK_FEE_USDC` | A hire's fee from which a person approves it with World ID (default 0.05) |

## Live checks (6 Nov 2026)

- The whole bonus, on a passkey account in the web app: Wallet page → **Verify with World ID** →
  QR scanned with an iPad → approved in the app → our server verified the token and linked the
  World ID → the sponsor sent 0.20 test USDC
  ([tx](https://hashscan.io/testnet/transaction/0xafe3906ff12545510d0c1ba8f2396b088b9eb5f810d318194a5766a88659ad9d)),
  the wallet went from 0.08 to 0.28 and the card turned to "Verified person".
- The checkpoint, on the same account in chat: "a hotel in Goa … keep watching the price" → offers
  from StayWise and PriceGuard → PriceGuard's Park Inn (fee 0.05) → no payment, the World ID card
  → **declined** on World's page → "You declined in the World ID app. Nothing was paid." (check
  `denied`, no hire) → **approved** → the quote had expired meanwhile, so the concierge got fresh
  prices; the approval covered the new quote → Face ID limit → hired, 0.05 USDC held in escrow
  ([tx](https://hashscan.io/testnet/transaction/0.0.11328382@1793936488.549097829)), the approval
  marked used → after the undo window PriceGuard booked it (reference LiugdfvpL) and is watching
  the price until check-in.
- Found on the way: the first version bound an approval to the quote, which expired during the
  decline-and-retry (fixed: agent and fee); approvals reached our server only once World's page
  was opened again (now said on the card); a passed payment approval ran the bonus code (no
  bonus was sent, since it had been had; fixed and tested).
- Token from the sandbox: `acr` = Orb, `amr` = `["pop"]`.
- On an iPhone simulator (no app installed): World's page offers "Continue with a passkey",
  "Continue with World ID" and "Deny connection". "Continue with World ID" leads to **Open World
  ID app**, a `worldidsandbox://` link, plus "Show QR code instead". On an iPad with the app
  installed, the link opened it and the approval came through (`acr` Orb).
