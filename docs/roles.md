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
the window ends.
