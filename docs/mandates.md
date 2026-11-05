# Spending limits and pay on delivery (MandateRegistry)

An owner gives an AI agent a **spending limit** (a mandate): a budget, a cap per payment, an
expiry and, optionally, the only payees it may pay. The agent signs each payment; the contract
checks every rule and only then moves exactly that amount. A payment can also wait in escrow:
first an **undo window**, then until the job is **delivered**.

Web2 analogy: a company card with spend rules, plus Gmail's "Undo send", plus an escrow service,
all run by public code that nobody, us included, can change.

## Who controls what

| Who | Can | Can't |
|---|---|---|
| **Owner** (the user's wallet) | Create and revoke limits; cancel a held payment in its undo window; release, or dispute after delivery | Nothing is held back from them |
| **Agent** (the AI) | Sign payments within the limit; cancel its own held payment in the window (refund only); release after delivery | Raise its limit; skip or shorten the undo window (it's part of what it signed); pay anyone not allowed |
| **Payee** (the merchant) | Mark delivered after the window, by the deadline; refund any time | Start during the window; get paid before release or the end of the review |
| **Anyone** (relayer, a Hedera scheduled transaction) | Submit agent-signed payments; pay out after the review; send back undelivered money after the deadline | Change a signed payment (amount, payee, window); cancel |
| **Us / an admin** | Nothing: the contract has no admin and can't be upgraded | Freeze, change or take money |

## Rules on every payment

1. The mandate and all its parents exist, aren't revoked and haven't expired.
2. The signed payment hasn't expired (`validBefore`) and its nonce is unused (each works once).
3. It's signed by the mandate's agent (a plain key or an ERC-1271 smart wallet).
4. `0 < amount <= perPaymentCap` and `amount <= budget - spent - delegated`.
5. The payee is allowed (if the mandate lists payees).
6. Then the spend is counted and the money moves (to the payee, or into escrow).

## Pay on delivery, with an undo window

| Step | Who | When |
|---|---|---|
| `payIntoEscrow` / `executeEscrowTransfer` (x402) | anyone, with the agent's `EscrowAuth` signature | money moves into the registry: **Held** |
| `cancel` | owner or agent | **during the undo window**: full refund, budget back |
| `markDelivered(id, resultHash)` | payee | **after** the window, by `deliverBy` |
| `release` | owner or agent | any time it's open |
| `dispute` | owner or agent | within `reviewSeconds` after delivery: frozen |
| `claim` | anyone, **including Hedera itself** | `reviewSeconds` after delivery, not disputed |
| `refund` | payee | any time it's open |
| `reclaim` | anyone | not delivered by `deliverBy` |

The window (`undoSeconds`, up to 7 days, so it can last overnight) is part of what the agent
signs, so nobody can remove or shorten it. Revoking a limit stops new payments; money already
held keeps following these rules.

### Hedera pays the merchant by itself (HIP-1215)

When the payee marks a job delivered, the registry asks Hedera's schedule service (system
contract `0x16b`, `scheduleCall`) to call its own `claim(id)` when the review ends. The network
stores that call and runs it on time, so the merchant is paid even if every server of ours is
down, with no bot. If the buyer disputed or released in the meantime, the scheduled `claim` is
simply refused. The registry pays those calls' fees from its own HBAR (anyone can top it up with
a plain transfer; it can only be spent on fees). If Hedera can't take the schedule, the
registry emits `PayoutNotScheduled` and anyone can still `claim` after the review.

Web2 analogy: a cron job that lives inside the database, run by the database itself.

### Over x402

x402's `executeEscrowTransfer(from, asset, to, amount, authorization)` checks that the money
reached `to`, so for a held payment **`to` is the registry itself** and the merchant (`payee`)
travels inside the agent-signed terms.

Sub-mandates: an agent can hand another agent a slice of its budget, signed by the parent's
agent; limits only get tighter, and revoking a parent stops the whole tree.

## Files

| Path | What |
|---|---|
| `packages/contracts/src/MandateRegistry.sol` | Create, sub-mandates, pay, x402 `executeTransfer`, revoke |
| `packages/contracts/src/mandate/MandateEscrow.sol` | Undo window and pay on delivery |
| `packages/contracts/src/mandate/MandateStore.sol` | Storage, views and the shared payment checks |
| `packages/contracts/src/mandate/MandateSignatures.sol` | EIP-712 types and signature checks |
| `packages/contracts/test/mandate/*.t.sol` | 61 tests, including fuzzing, invariants and the scheduled payout (against a stand-in for `0x16b`) |
| `packages/mandates/src/` | TypeScript: ABI, signing, `MandateClient`, deploy |
| `packages/mandates/scripts/` | `deploy-registry`, `demo` (live walkthrough) |

Invariants, over 8,192 random calls (pay, hold, cancel, deliver, release, claim, dispute, refund,
reclaim, time jumps): the registry holds exactly what's in open escrows; the owner loses exactly
what was paid out or is still held; spending never passes the budget.

## Deployment (Hedera testnet)

`MandateRegistry` at `0x1776b14d2af3df71500ab9ebb432739622e08442`
([0.0.11329497](https://hashscan.io/testnet/contract/0.0.11329497)), opted in to test USDC and
holding 20 HBAR for scheduled payouts. Deployed by the operator; it has no owner. Earlier test
deployments (`0.0.11328912`, `0.0.11329422`) are retired.

## Live test (testnet, 6 Nov 2026)

`pnpm --filter @app/mandates demo`

| Step | Result |
|---|---|
| Limit: 0.10 USDC, 0.05 per payment, one hotel only | ✅ [tx](https://hashscan.io/testnet/transaction/0x2b1f08390355fadc534778835324ff72d2a049a281a2c6347925151ae772d0e5) |
| Agent pays 0.02 into escrow with a 60 s undo window; the relayer pays the fee | ✅ [tx](https://hashscan.io/testnet/transaction/0x1e02f283ede2323f30c30eed664d7ccfbb47e0aaf069f0717491af7a46915819) |
| Relayer tries to cancel | ❌ `NotAuthorized` |
| Hotel tries to deliver during the window | ❌ `TooEarly` |
| Owner cancels in the window: refunded, limit back to 0.10 | ✅ [tx](https://hashscan.io/testnet/transaction/0xd8000b08ab5f7a1f728b04c5de9251cea0ae3f439f3d1c32d5e86bff53b3be61) |
| 0.02 held with a 15 s window; after it, the hotel marks delivered | ✅ [tx](https://hashscan.io/testnet/transaction/0xeaff257f3f348f8ab1866fbac5ef9925c788af02e33160a5995f3e4a46492cd0) |
| Owner tries to cancel after delivery | ❌ `WrongEscrowState` |
| Owner releases: the hotel is paid | ✅ [tx](https://hashscan.io/testnet/transaction/0xac56faf486d319a635a866b47155173a412deb5c1e5a1d2b6334695bc06b5ada) |
| 0.01 held, delivered; the registry schedules its own payout | ✅ [tx](https://hashscan.io/testnet/transaction/0xeb511adcdf5443f2c1b9552332b19c0b3830558ea0f1839dda6eddc2372d2d8b) |
| Nobody calls anything: Hedera runs `claim` at the end of the review (payer: the registry) | ✅ [schedule 0.0.11329518](https://hashscan.io/testnet/schedule/0.0.11329518), executed `SUCCESS` |
| Balances after: hotel 0.03 USDC, registry 0 | ✅ |
| Relayer submits more than the agent signed | ❌ `BadSignature` |
| Relayer removes the undo window | ❌ `BadSignature` |
| Agent signs more than the per-payment cap | ❌ `OverPaymentCap` |

## Gotchas found

- **Hedera's `block.timestamp` is the start of the ~2 s block.** The first scheduled payout ran
  at exactly the second we asked for, yet `claim` saw a time 1–2 s earlier and refused it
  (`TooEarly`). Payouts are now scheduled `PAYOUT_DELAY` (5 s) after the review ends.
- **Scheduling costs gas.** `markDelivered` with a scheduled payout used ~1.5M gas (about 1 test
  HBAR), paid by the merchant who delivers. Fine on testnet; worth knowing.
- **The JSON-RPC relay (Hashio) can hang.** One deploy never reached the network; rerunning it
  worked in seconds. Scripts that wait on it should have a time limit.
