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
- **Ratings only from verified people.** After a job, the hire card asks "How did PriceGuard
  do?" A rating counts only after World ID, one per person per agent, and it's posted on Arkiv,
  where it ranks the market.

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

**What counts as larger:** the whole payment into escrow, the agent's fee plus the trip price
(`hireTotal`), not the fee alone: a cheap agent booking an expensive stay asks too.

**Shops** (paying in person): becoming a shop needs a verified person, so one person can't set up
look-alike shops. See [in-person.md](in-person.md).

## Rating an agent

1. Once the job is done (`delivered` or `released`), the hire card shows 1–5 stars
   (`POST /chats/:id/hires/:hireId/rating`). A passkey account with a linked World ID rates at
   once; any other account approves a World ID check first (purpose `rate`), and the rating is
   posted when it passes. Declined: nothing is posted.
2. Our server posts it on Arkiv (`ethglobal-2026.verified-rating`) with **our** writer: anyone can
   write under that name, but readers count only ratings our writer made.
3. Who rated is a **pseudonym for that one agent**: an HMAC of the World ID and the agent with
   `RATINGS_SECRET`. The same person rating the same agent again gets the same pseudonym (the
   newest counts, so one per person per agent, from any account); for another agent it's a
   different one, so a person's ratings can't be linked across agents. The World ID, the account
   and the hire never go on Arkiv.
4. The market reads them back and ranks agents by them, the average pulled towards 3 stars as if
   two more people had given 3 (one 5★ can't beat many good ratings), then by deliveries, then
   fee. The concierge sees "5.0/5 from 1 verified person"; the cards show "★ 5.0 · 1 verified
   person".

## Deal drops: one per person (IDKit)

A deal drop is a few of something good, offered fairly: **one per person**, however many
accounts that person makes. The first drop, "Your next agent fee, on us", lets 20 people each
get their next booking's agent fee paid back (up to 0.05 USDC), once that booking's agent is paid.

This uses World ID through **IDKit** (`@worldcoin/idkit` 4.6 in the app, `@worldcoin/idkit-core`
on the server; `apps/api/src/deals`), not the sign-in used above:

1. **Start**: `POST /deals/:id/start`. Our server signs the request (`signRequest`, with
   `WORLD_IDKIT_SIGNING_KEY`, which never leaves the server) for the drop's action
   (`deal-<drop>`), and binds it to the account (the signal is the account id).
2. **Prove**: the wallet page opens IDKit's widget, asking for a World ID 4.0 proof of human
   (`proofOfHuman`). The person scans it and approves in World's app: in sandbox, the "World ID
   sbx" app; in staging, World's web simulator.
3. **Claim**: `POST /deals/:id/claim` with the result. The server checks:
   - it's a **World ID 4.0** proof. Older 3.0 proofs are refused: the same person's 3.0 proof
     has another nullifier, so taking both would let them claim twice (World's team agreed:
     one nullifier);
   - the environment and action are the ones we expect;
   - the signal hash is this account's, so nobody can use someone else's proof;
   - World accepts the proof (`POST https://developer.world.org/api/v4/verify/<rp_id>`).
   Then it stores the **nullifier**: the same for this person and this drop every time, and
   unlinkable to anything else. It's unique per drop, so the same person can't claim again from
   another account. It's also one per account.
4. **Payback**: when the account's next booking is released (its agent paid after the review
   window), Shikigami sends that fee back to the wallet. A refunded or disputed booking is never
   released, so nothing is paid twice.

| When | What the person sees |
|---|---|
| Claimed | "Claimed: your next booking's fee comes back once its agent is paid." |
| Paid back | "Paid back to your wallet", with the Hedera transaction; the chat says so too |
| Same person again (any account) | "This World ID has claimed it already: one per person." |
| Same account again | "You've claimed this one already." |
| All claimed / ended | "All claimed: they're gone." / "This deal has ended." |
| Closed or declined in World App | "World ID didn't finish. Nothing was claimed." |
| A proof for another account, action or environment | Refused, with the reason |

Settings: `WORLD_IDKIT_APP_ID` (`app_…`), `WORLD_IDKIT_RP_ID` (`rp_…`), `WORLD_IDKIT_SIGNING_KEY`
(secret), `WORLD_IDKIT_ENV` (`sandbox` by default, as World's team asked for the event: the
"World ID sbx" app; `staging` for the web simulator; `production` for the World ID app).
Without them the drop is hidden.

Set up through World's Developer Portal MCP (`https://developer.world.org/api/mcp`, with
`WORLD_DEV_PORTAL_API_KEY`):
1. `create_app` made app `app_d07a3605682ac573d548059b9b81c4d3`.
2. `configure_world_id` registered a managed World ID 4.0 RP, `rp_ac1e91b4a0c19725`, on
   production and staging. Its signing key was made on our machine and went straight to `.env`.
3. `create_world_id_action` made `deal-fee-back-1` in both environments.

**Live, sandbox (6 Nov 2026):** the user scanned the QR with the "World ID sbx" app on an iPad
and approved. World verified the 4.0 proof, the nullifier was stored, and the card said
"Claimed…", with 19 of 20 left.

**Live, staging (6 Nov 2026, earlier):**
1. The wallet's deal card opened IDKit's widget, and "Use the simulator" opened World's simulator
   with our request ("Unique Human · Claim the deal drop…").
2. Approving there sent the proof back; our server checked it with World and stored the nullifier.
3. The card said "Claimed: your next booking's fee comes back once its agent is paid", and 19 of
   20 were left.

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
| `WORLD_CHECK_FEE_USDC` | A hire's payment into escrow (the agent's fee plus the trip price, at testnet scale) from which a person approves it with World ID (default 0.05, about a ₹30,000 stay with a 0.02 fee) |
| `RATINGS_SECRET` | Makes raters' pseudonyms (any long random string; keep it, or old ratings stop matching). Without it, rating is off |

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
- A verified rating: on that hire's card (done · paid), 5★ → posted on Arkiv at once (the account
  has a linked World ID) under a pseudonym → read back, trusting our writer: PriceGuard 5/5 from 1
  verified person → the concierge said so, and the agents card showed "★ 5.0 · 1 verified person".
- Token from the sandbox: `acr` = Orb, `amr` = `["pop"]`.
- On an iPhone simulator (no app installed): World's page offers "Continue with a passkey",
  "Continue with World ID" and "Deny connection". "Continue with World ID" leads to **Open World
  ID app**, a `worldidsandbox://` link, plus "Show QR code instead". On an iPad with the app
  installed, the link opened it and the approval came through (`acr` Orb).

## Integration debrief (for World)

What we built on Agent Pass (sandbox issuer, OIDC device flow, our own server checks): a welcome
bonus once per person, a human checkpoint before larger agent payments (with the decline and
timeout paths), and ratings on Arkiv that count only from verified people.

**Time to first success.** We reused the Agent Pass app and the client code from our practice
build, so no new registration. About 20 minutes after starting, the first approved check was
validated on our server and its protected action ran (the bonus, paid on Hedera). The checkpoint
before payments, with a live decline and a live approval, took under an hour more; most of that
went on the two issues marked ★ below.

**Friction.**

1. ★ **An approval reaches the token endpoint only after World's page is opened again.** The
   person approves in the World ID app; until World's authorize page is loaded again ("Return
   here to finish verification"), our server's polls keep getting `authorization_pending`. In a
   device flow (RFC 8628) the device shouldn't depend on the browser coming back, and nothing in
   the docs says this step is required. We now tell people on our card to go back to World's page.
2. ★ **Which app?** The App Store now has "World ID — Proof of Human" and "World Money" (which
   used to be World App), and the docs and prize page say "World App". The sandbox page's **Open
   World ID app** is a `worldidsandbox://` link, so it opens only the TestFlight sandbox app; on a
   phone without it, the button does nothing (no store link, no message). Whether the public World
   ID app can approve sandbox requests isn't stated anywhere we found.
3. **"Continue with a passkey"** on the sandbox page only signs in an existing World ID passkey.
   With none, the browser just says there are no passkeys for `sandbox.auth.world.org`; the page
   doesn't say how to get one.
4. **The prize page says proofs are mocked and the sandbox app isn't needed**, but the sandbox
   page still sends people to the sandbox app, and we found no mocked path that works without it.
5. **A sandbox token looks like a production one**: `acr` = Orb, `amr` = `["pop"]`. Only `iss`
   tells them apart, so code has to check the issuer to keep sandbox approvals out of production.
6. Still true from our first build: the sandbox app needs TestFlight's public link (opening
   TestFlight directly asks for an invitation), Developer options → v4 protocol and credential
   issuance, and about an hour before the test credential works.

**Missing capability or documentation.**

- A documented way to approve sandbox requests without installing anything (a "mock approve"
  button on the sandbox page), so judges and teammates can try a flow in a minute.
- Showing *what* is being approved: the device flow has no `binding_message`, so World's page
  and app show only our app's name and a code. We bind the approval to one payment ourselves.
- A fallback for the `worldidsandbox://` link (a store or TestFlight link, or a web approval).
- The "return to this page" step, documented for device-flow clients.

**The one improvement with the greatest impact:** a no-install way to complete sandbox Agent Pass
requests (mock approve on the sandbox page). Every hackathon judge would then be able to try the
World ID part of a project themselves, instead of watching a video of it.
