# World ID (apps/api/src/world)

World ID proves someone is a real, unique person without telling us who they are: no name, no
email. Each person gets one ID for our app (`sub`), always the same. Web2 analogy: "Sign in with
Google", except it answers only "is this one real person, and the same one as before?".

We use World's **Agent Pass** (OpenID Connect, device flow) for:

- **A welcome bonus, once per person.** Prove you're a person and your Face ID wallet gets
  +0.20 test USDC from our sponsor. The sign-up gift (0.10) needs nothing, so nobody is blocked.

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

## What people need

The free **World ID** app ([iPhone and iPad](https://apps.apple.com/app/id6760839426),
[Android](https://play.google.com/store/apps/details?id=org.world.id)). Our hackathon build
uses World's **sandbox** (`WORLD_ID_ISSUER=https://sandbox.auth.world.org`): its page says
"Uses fake identities", and the normal World ID app approves its checks. No Orb visit, and no
production registration.

- **Laptop:** scan the QR code on the Wallet page with your phone.
- **Phone or tablet only:** tap **Open World ID**, then **Continue with World ID** and **Open World
  ID app** on World's page; approve, and come back.

## Settings (.env)

| Name | |
|------|--|
| `WORLD_ID_ISSUER` | `https://sandbox.auth.world.org` for the hackathon (default: `https://auth.world.org`) |
| `WORLD_ID_CLIENT_ID`, `WORLD_ID_CLIENT_SECRET` | From World's developer portal (Agent Pass app). Without them, World ID is off and the page doesn't show it |
| `WORLD_BONUS_USDC` | The bonus (default 0.20) |
| `WORLD_BONUSES_PER_DAY` | Across everyone (default 20) |

## Live checks (6 Nov 2026)

- The whole bonus, on a passkey account in the web app: Wallet page → **Verify with World ID** →
  QR scanned with an iPad → approved in the app → our server verified the token and linked the
  World ID → the sponsor sent 0.20 test USDC
  ([tx](https://hashscan.io/testnet/transaction/0xafe3906ff12545510d0c1ba8f2396b088b9eb5f810d318194a5766a88659ad9d)),
  the wallet went from 0.08 to 0.28 and the card turned to "Verified person".
- Token from the sandbox: `acr` = Orb, `amr` = `["pop"]`.
- On an iPhone simulator (no app installed): World's page offers "Continue with a passkey",
  "Continue with World ID" and "Deny connection". "Continue with World ID" leads to **Open World
  ID app**, a `worldidsandbox://` link, plus "Show QR code instead". On an iPad with the app
  installed, the link opened it and the approval came through (`acr` Orb).
