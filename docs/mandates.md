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
| `claim` | anyone | `reviewSeconds` after delivery, not disputed |
| `refund` | payee | any time it's open |
| `reclaim` | anyone | not delivered by `deliverBy` |

The window (`undoSeconds`, up to 7 days, so it can last overnight) is part of what the agent
signs, so nobody can remove or shorten it. Revoking a limit stops new payments; money already
held keeps following these rules. `claim` being open to anyone means a Hedera scheduled
transaction can pay the merchant when the review ends, with no server involved.

Sub-mandates: an agent can hand another agent a slice of its budget, signed by the parent's
agent; limits only get tighter, and revoking a parent stops the whole tree.

## Files

| Path | What |
|---|---|
| `packages/contracts/src/MandateRegistry.sol` | Create, sub-mandates, pay, x402 `executeTransfer`, revoke |
| `packages/contracts/src/mandate/MandateEscrow.sol` | Undo window and pay on delivery |
| `packages/contracts/src/mandate/MandateStore.sol` | Storage, views and the shared payment checks |
| `packages/contracts/src/mandate/MandateSignatures.sol` | EIP-712 types and signature checks |
| `packages/contracts/test/mandate/*.t.sol` | 54 tests, including fuzzing and invariants |
| `packages/mandates/src/` | TypeScript: ABI, signing, `MandateClient`, deploy |
| `packages/mandates/scripts/` | `deploy-registry`, `demo` (live walkthrough) |

Invariants, over 8,192 random calls (pay, hold, cancel, deliver, release, claim, dispute, refund,
reclaim, time jumps): the registry holds exactly what's in open escrows; the owner loses exactly
what was paid out or is still held; spending never passes the budget.

## Deployment (Hedera testnet)

`MandateRegistry` at `0x43dcb9d2efa35e0e0c1d818a99cb4e608b1a2f98`
([0.0.11328912](https://hashscan.io/testnet/contract/0.0.11328912)), opted in to test USDC.
Deployed by the operator; it has no owner.

## Live test (testnet, 6 Nov 2026)

`pnpm --filter @app/mandates demo`

| Step | Result |
|---|---|
| Limit #1: 0.10 USDC, 0.05 per payment, one hotel only | ✅ [tx](https://hashscan.io/testnet/transaction/0x8e625250aa0c245924a42df54d7af0e0fd3ec33205b540ffaabd5cba1608a8f1) |
| Agent pays 0.02 into escrow with a 60 s undo window; the relayer pays the fee | ✅ [tx](https://hashscan.io/testnet/transaction/0x3fcb60864bb4905b50c1e9a2789259fc66df357f8035b322a2096819ffb5d42c) |
| Relayer tries to cancel | ❌ `NotAuthorized` |
| Hotel tries to deliver during the window | ❌ `TooEarly` |
| Owner cancels in the window: refunded, limit back to 0.10 | ✅ [tx](https://hashscan.io/testnet/transaction/0x0fd02d6796cae29f6c1abae2588565d0617ea3ded9405b7bda59fe15eb6a986c) |
| 0.02 held with a 15 s window; after it, the hotel marks delivered | ✅ [tx](https://hashscan.io/testnet/transaction/0x130865ea1cda7b5b860e3649b88c2f730d5141b5a0da805befb9df599743bb93) |
| Owner tries to cancel after delivery | ❌ `WrongEscrowState` |
| Owner releases: the hotel holds 0.02 USDC, the registry 0 | ✅ [tx](https://hashscan.io/testnet/transaction/0x1c89b9150873fc3274d3d18f1f89e29a0d467109fa8e01e67a1a9de4e2790921) |
| Relayer submits more than the agent signed | ❌ `BadSignature` |
| Relayer removes the undo window | ❌ `BadSignature` |
| Agent signs more than the per-payment cap | ❌ `OverPaymentCap` |
