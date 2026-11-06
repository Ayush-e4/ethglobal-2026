# Who controls what

Every key we hold has exactly one job. This page says who holds each key, what it can do and
what it can't. A PR that adds a key, a role or an admin power updates this page (the PR template
asks).

## Hedera accounts

| Role | Settings in `.env` | Can | Can't |
|---|---|---|---|
| **Operator** | `HEDERA_ACCOUNT_ID`, `HEDERA_PRIVATE_KEY` | Set things up: create the other accounts and the public log, opt in to USDC | Write to the public log; move anyone else's money |
| **Relayer** | `RELAYER_ACCOUNT_ID`, `RELAYER_PRIVATE_KEY` | Pay network fees for transactions other people signed, so users need no HBAR | Move anyone's money: it only submits what someone else already signed |
| **Log writer** | `LOG_WRITER_ACCOUNT_ID`, `LOG_WRITER_PRIVATE_KEY` | Write entries to the public log | Delete or edit the log; pay anyone |

Web2 analogy: separate API keys for the deploy script, the payment processor and the audit
logger, instead of one root key that does everything.

## The public log

An HCS topic (`SPEND_LOG_TOPIC_ID`) created with **no admin key**: nobody, us included, can
delete it, change it or take back what's written. Its submit key is the log writer's, so only the
log writer can add to it. Anyone can read it on HashScan or the mirror node.

## How it's checked

- `pnpm status:testnet` prints this table from code (`packages/hedera/src/roles.ts`)
  and checks each account, plus that the log has no admin key and only the log writer can write.
- `log-demo` writes as the log writer, then shows the operator's key is refused.
- `pay-demo` pays from the operator, then shows the relayer can't move the operator's USDC.

## Spending limits (MandateRegistry)

The contract has **no admin** and can't be upgraded: nobody, us included, can freeze it, change
its rules or move money in it. Who can do what with a limit and a held payment is in
[mandates.md](mandates.md#who-controls-what). In short: the owner and the AI can undo a payment
during its window, only the owner can create or raise a limit, and the merchant can't start until
the window ends. The registry also holds a little HBAR that anyone can add to; it can only pay
the fees of the payouts it schedules on Hedera.

## Face ID wallets (PasskeyWallet)

Each person's wallet answers **only to their passkeys** (Face ID, a fingerprint), one per device.
Whoever submits a signed batch pays its gas but can't change it or move anything without one.
The factory has no owner; we hold no admin or recovery key over any wallet. Details in
[wallet.md](wallet.md#who-controls-what).

## x402 facilitator

Our facilitator submits x402 payments with the **relayer** key: it pays the fee and wraps the
call, and can't move money itself (it only calls admitted contracts with a call it builds from
the requirements). The **log writer** adds an `x402.settled` entry for each payment. Details in
[x402.md](x402.md#who-controls-what).

## Arkiv

Our **Arkiv writer** (`ARKIV_WRITER_PRIVATE_KEY`, its own wallet on Arkiv) records jobs, receipts
and ratings. Each agent writes its own profile, listings, quotes and deliveries with its own key;
reads only count a record written by the party it names. Details in
[arkiv.md](arkiv.md#who-controls-what).

## Agents

Each agent has **one key of its own**, used as its Hedera account (paid into; marks deliveries,
refunds) and as its Arkiv writer. StayWise: `STAYWISE_PRIVATE_KEY` / `STAYWISE_ACCOUNT_ID`,
created by `pnpm --filter @app/agents agents-setup` and funded from the operator (HBAR) and our
Arkiv writer (test GLM). Details in [agents.md](agents.md).

## App accounts and admins

People sign in with a passkey or "Try the demo". Every account is a `user`; `admin` only for ids in
`ADMIN_USERS`, a server setting. No app role can move money or change the contracts. See
[api.md](api.md#roles).

## Hiring

- **Concierge key** (`CONCIERGE_PRIVATE_KEY`, `pnpm --filter @app/api hiring-setup`): the AI's key.
  It only signs payments a spending limit allows; no Hedera account, no HBAR, can't raise a limit.
- **Demo wallet** (`DEMO_WALLET_*`, a Hedera role made by `pnpm setup:testnet`): holds test USDC for
  "Try the demo" and owns those chats' limits; it can undo a held payment for its user. Daily caps
  in the API keep one person from emptying it.
