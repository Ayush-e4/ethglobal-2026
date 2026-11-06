# Paying in person (Live QR and Chirp to Pay)

The last 30 cm, when the payer and the shop stand in front of each other. From the Live QR and
Chirp to Pay labs (built and tested on two devices before they came here). Two ways to carry the
same signed request: a **Live QR** on the shop's screen, or a **chirp** from its speaker.

## The flow

1. **Get paid** (`/get-paid`, the shop's screen): a passkey account names itself once ("Chai
   Point, Bandra") and is paid into its own Face ID wallet. It enters an amount (₹, paid at
   testnet scale: ₹1 = 0.000001 test USDC) and shows a **Live QR**.
2. **Pay** (`/pay`, the customer's phone): scan it. Before anything moves, the phone shows who
   and how much, checked by our server, then **Live screen ✓** once it has read the QR's hidden
   layer. Pay.
3. The money moves on Hedera: an x402 payment through our facilitator and MandateRegistry,
   straight to the shop's account, within the payer's limit for that shop (Face ID once), or from
   the demo wallet for demo accounts. The shop's screen turns **Paid** by itself.

## Chirp to Pay (sound)

Next to the QR, **Play the chirp too** plays the same 24-byte request as sound with
[ggwave](https://github.com/ggerganov/ggwave) (MIT: tones between 1.9 and 6.4 kHz with
Reed-Solomon error correction, WebAssembly, served from `public/vendor/ggwave.js`). It alternates
a fast chirp (0.7 s) and an echo-proof one (2.1 s), with gaps, until it's paid or expires.
On the phone, **Listen to pay** opens the microphone with calls' echo and noise cancelling off
(they erase steady tones), listens for both speeds, stops at the first request it hears, and
shows the same checked sheet: who, how much, "heard from the shop's device just now". Hold the
phone 20–50 cm away and still: the lab's maths and ~2,900 simulated rooms say audible chirps
survive a hand moving up to ~1.3 m/s, and that close range beats echo.

## Why a scanned QR can't be faked

- **The request is signed.** Its 24 bytes (payee, amount, a one-time number, an expiry) carry a
  tag made with the shop's key, which only our server holds: a stranger's QR, or a changed
  amount, is refused before the payer sees a Pay button.
- **The QR is live.** Over the plain QR (any camera reads it) a colour flicker too faint to see
  carries a code that changes every 250 ms, made with a key for that one request. The scanner
  follows the flicker and the server checks the code is genuine and from the last 3 seconds. A
  sticker pasted over a shop's QR, or a screenshot sent on WhatsApp, shows an old code or none:
  "could be a sticker or a screenshot", and only **Pay anyway** remains.
- **Paid once.** A request is claimed before paying, so two phones can't both pay it, and it
  expires after 2 minutes.
- **Nothing over the air uses elliptic curves**: the tags are HMAC-SHA256.

## Code

| Where | What |
|---|---|
| `packages/shared/src/inperson.ts` | The 24-byte request, its tag, the live code (shared by the app and the server) |
| `apps/api/src/inperson` | Merchants and requests (`merchants.ts`), checking and paying (`pay.ts`), the x402 settle (`settle.ts`), routes |
| `apps/web/src/lib/inperson` | The lab's QR drawing, hidden layer and camera geometry |
| `apps/web/src/lib/inperson` (`modem.js`, `audio.js`) | The lab's ggwave wrapper and browser audio |
| `apps/web/src/components/inperson` | The Live QR canvas, the scanner, the chirp and listener, the two screens |

Routes: `GET/POST /merchant`, `POST /merchant/requests { inr }`, `GET /merchant/requests/:id`,
`POST /pay/check { frame, live? }`, `POST /pay { frame, live?, how }` (409 `needs_limit` with the
Face ID limit card first).

## Checked

- Tests: the request reads back and a forged or changed one fails; a live code is good for a
  few seconds and a screenshot's isn't; your own request and a demo merchant are refused; a
  passkey payer approves a limit first. **Screen to scanner**: the Live QR's frames, drawn at
  60 fps and read at 30, give a live code the server accepts. **Speaker to mic**: a request
  played in both speeds through our modem is heard back exactly. In the app's page, ggwave loads
  from `/vendor` and round-trips a request in 0.70 s of sound.
- Live against the API: a merchant on a real Face ID wallet (0.0.11341027), a ₹40 request, the
  payer's check (live ✓, a screenshot's code refused, your own request refused). The payment
  itself waits for Hedera's RPC (Hashio was down when this was built): it then says nothing was
  charged.
