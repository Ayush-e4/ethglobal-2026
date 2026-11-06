# Face ID wallets (PasskeyWallet)

A wallet on Hedera that only the person's passkeys control: Face ID on a phone, a fingerprint on
a laptop. No seed phrase, no browser extension, no HBAR needed. Our server submits each
transaction and pays its gas, but it can't move anything the wallet holds: the wallet runs a
batch of calls only with a passkey signature over exactly that batch.

Web2 analogy: "Sign in with Face ID" that also approves payments, where the bank can't approve
one for you.

## How it works

- **One wallet per first passkey**, made by `PasskeyWalletFactory` at an address known before it
  exists (CREATE2 from the passkey's public key), and opted in to USDC (Hedera accounts opt in
  to each token).
- **A move is a batch** of calls (for example "let the registry pull 0.10 USDC, then create the
  limit"). The wallet's `digest(calls, deadline)` covers the chain, the wallet, its nonce and the
  deadline; that digest is the **WebAuthn challenge** the device signs.
- **The contract checks the passkey on-chain** (`PasskeySignature.sol`): the `webauthn.get`
  ceremony, our challenge, user present **and verified** (Face ID, not just a tap), and the P-256
  signature. Hedera has no P-256 precompile, so it uses OpenZeppelin's Solidity verifier.
- **All or nothing**: if any call fails, the whole batch is undone. Each signed batch runs once
  (the nonce), and not after its deadline.
- **More devices**: letting another device's passkey in (`addKey`) or shutting a lost one out
  (`removeKey`) is itself a batch, so only a passkey the wallet already trusts can do it. The last
  passkey can't be removed.
- **ERC-1271**: other contracts can check a signature from any of its passkeys.

## Who controls what

| Who | Can | Can't |
|---|---|---|
| The person's passkeys | Run any batch: set or cancel limits, pay, add or remove a device | Run a batch twice, or after its deadline |
| Whoever submits (our server) | Pay the gas to submit a signed batch | Change the batch (the signature no longer matches), or move anything without one |
| `PasskeyWalletFactory` | Make a wallet for a passkey and opt it in to a token, once | Anything else: it has no owner and no admin |
| Us | Nothing over a wallet | Freeze, upgrade or recover a wallet. There is no admin key and no recovery key |

Undo still works in one tap for a Face ID user's hires: the escrow lets the limit's AI key (the
concierge) cancel during the undo window too, so undoing needs no second Face ID.

## Deployed (Hedera testnet)

| | Address | Hedera id |
|---|---|---|
| PasskeyWalletFactory | `0x34550f62689c02b80f4b65942a0a4dd62af3d491` | [0.0.11331897](https://hashscan.io/testnet/contract/0.0.11331897) |

`pnpm --filter @app/contracts build && pnpm --filter @app/mandates deploy-wallets` deploys it and
saves `PASSKEY_WALLET_FACTORY_ADDRESS` / `_ID` in `.env`.

## Live test (6 Nov 2026)

`pnpm --filter @app/mandates wallet-demo`: software passkeys stand in for Face ID, and the
operator submits everything (it decides nothing):

```
1. The phone's passkey makes a wallet, at an address known in advance
   0x81c7b031E4965A6F6E67d65532CC51cEb201B327 (as computed: true), given 0.05 test USDC
   https://hashscan.io/testnet/transaction/0x99d996bfd694721f76a10f5769f3f59bc8e22796f573ece9d87b0138671c5ab0
2. A stranger's passkey tries to set a limit
   refused: NotAKey
3. The phone approves a 0.02 limit, but someone submits 0.05 instead
   refused: BadSignature
4. Face ID on the phone sets the 0.02 limit
   limit #17, owned by the wallet: true  https://hashscan.io/testnet/transaction/0x41ef30b147a1d951025797b17bfedab04a24bd26855aa01f6737edbae5d345ae
5. The phone lets the laptop in; the laptop cancels the limit
   laptop is a key: true  https://hashscan.io/testnet/transaction/0x26db4c0c3a80002b342dc43456ff16aecd5f2dea7ad9e2b63e452ca9321329fc
   cancelled: true  https://hashscan.io/testnet/transaction/0x6deb54bbb5b16af441b25faf657a4ede8b42308a9cc895927ed1172f67898d18
6. The laptop is lost: the phone shuts it out
   laptop is a key: false  https://hashscan.io/testnet/transaction/0xc4dafdf7f79da40c0abbcdbfc20bdea5e8c5a153f31745a5913cce63e16a7ffb
   the laptop setting a limit now: NotAKey
```

## In the app

Signing up with a passkey makes the account's wallet (about 13 s on testnet: the factory call,
the mirror showing its Hedera id, the gift). **Wallet** in the sidebar shows it: test USDC, its
Hedera account on HashScan, and how to get more test USDC from Circle's faucet. Live
(`pnpm --filter @app/api wallet-signup-demo`, a software passkey through the real API):

```
✓ signed up with a passkey
✓ wallet ready in 13s
  0x9456f9742f1C5398f44A31474a5Df504d9903592  https://hashscan.io/testnet/account/0.0.11331997
  0.1 test USDC
```

## Paying an agent from your own wallet

A demo account pays from the shared demo wallet. A passkey account pays from **its own** wallet,
so the first time the concierge books an agent in a chat, it asks for a limit instead:

1. `book_quote` finds no limit with room for that agent in this chat → the **limit card**: up to
   0.10 USDC in fees, 0.05 a payment, only to that agent, for 24 hours.
2. **Approve with Face ID**: `POST /chats/:id/limits/face-id { payee }` prepares the wallet's batch
   (let the registry pull the budget, then create the limit for the concierge's key) and returns
   its digest as the WebAuthn challenge. The device signs it.
3. `POST /chats/:id/limits { opId, response }`: the API checks the answer is for our site, our
   challenge and one of the wallet's passkeys; the sponsor submits it; the **wallet contract
   checks the signature itself** and creates the limit, owned by the wallet.
4. The card sends the booking again; this time it's paid from the wallet's limit: held, booked,
   and paid out by Hedera after the review window.

Approvals are kept in the database (`wallet_ops`), work once, and expire after 5 minutes. Undo is
still one tap: the concierge (the limit's AI key) can cancel during the window, no Face ID needed.

**Your limits** are on the Wallet page: the agent, the chat, what's left, until when. **Cancel**
is a Face ID approval too: the wallet revokes the limit on Hedera (`revoke` in the registry), and
the concierge can't pay from it any more. Gas per kind of move: setting a limit 2M (1.2M used),
cancelling 0.8M (0.3M used); Hedera charges at least 80% of the limit, so each kind has its own.

Live (`pnpm --filter @app/api face-id-hire-demo`, a software passkey through the real API):

```
✓ signed up; Face ID wallet 0.0.11332504 holds 0.10 test USDC
✓ got live quotes
✓ the concierge asks for a limit: up to 0.10 USDC for StayWise
✓ Face ID approved limit #23  https://hashscan.io/testnet/transaction/0xb123d2462521ebebec0bed40a6616c8e29b61d450f6716ada888ab4eecb8082d
✓ hired; fee held  https://hashscan.io/testnet/transaction/0.0.11328382@1793927315.427308232
  held
  delivered (booking y0SRra3_i)
  released (booking y0SRra3_i)
✓ done: released; the wallet now holds 0.08 test USDC
✓ listed: active, 0.08 USDC left
✓ Face ID cancelled it: cancelled  https://hashscan.io/testnet/transaction/0xa1019a530fda48898dd4d63633287c5cb4c4d82ad1899e9b1d57c1c2b16b8337
```

## Gotchas

- **Reads lag the receipt.** Hedera's JSON-RPC answers reads from a mirror node a moment behind.
  Right after a batch, reading the wallet's nonce could still show the old one, and the next
  batch would be signed over a stale digest. `PasskeyWalletClient.execute` waits until reads show
  the nonce used up; `create` waits until reads show the wallet's code.
- **Hashio sometimes prices gas in tinybars.** Now and then it reports a block's base fee 1e10
  times too small, and a transaction priced from it is refused ("gas price below the minimum").
  Our `hederaTestnet` chain (in `@app/mandates`, used by every viem write) prices from
  `eth_gasPrice` instead and scales a tinybar answer back up.
- **`s` must be low.** Devices return either half; the contract wants the low one, so
  `assertionFromWebAuthn` flips a high `s` (a P-256 signature stays valid when flipped).
- **Setting a limit costs about 1.2M gas** on Hedera (the USDC approve goes through the token
  service). `execute` allows 2M by default.
- **The approve adds up.** A new limit raises the registry's USDC allowance by its budget instead
  of replacing it, so it can't starve the wallet's other limits.

Code: `packages/contracts/src/wallet/`, `packages/mandates/src/passkey-wallet.ts`.
