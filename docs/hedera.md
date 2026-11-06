# Hedera basics

The pieces of Hedera we use, in web2 terms, and how to set them up.

| Hedera feature | Web2 analogy | Our use |
|---|---|---|
| Accounts (`0.0.x`) with ECDSA keys | A bank account and its password | One account per job ([roles.md](roles.md)) |
| HBAR | API credits for fees | Network fees |
| HTS token (USDC `0.0.429274`) | A built-in currency | Payments |
| Token association | Enabling a currency on a card | Accounts opt in to USDC once |
| HCS topic | An append-only Kafka topic nobody can edit | The public spend log |
| Mirror node REST | A public read replica | Balances, the log, who controls a topic |

## Package `@app/hedera`

| File | Purpose |
|---|---|
| `roles.ts` | Each role's job and what it can't do |
| `config.ts` | Reads the network and each role's account from `.env`; errors name the setting, never its value |
| `client.ts` | A client per role; HashScan links |
| `accounts.ts` | New ECDSA accounts; USDC opt-in |
| `payments.ts` | Atomic token and HBAR transfers |
| `hcs.ts` | Topics with no admin key; writing entries |
| `mirror.ts` | Balances, topic details and messages |
| `env-file.ts` | Saves new accounts into `.env` (owner-only file) without printing keys |

## Setup

1. Make a testnet account at portal.hedera.com with an **ECDSA** key. Put its id and key in
   `.env` as `HEDERA_ACCOUNT_ID` and `HEDERA_PRIVATE_KEY` (hex or the portal's DER form).
2. `pnpm setup:testnet`: opts the operator in to USDC, creates the relayer and log writer
   accounts and the public log, and writes them into `.env`. Safe to re-run.
3. Get test USDC for the operator at faucet.circle.com (Hedera Testnet).
4. `pnpm status:testnet` checks it all.

## Gotchas

- Use **ECDSA** keys, not ED25519: the same key then signs Hedera transactions and EVM messages.
- Read balances from the **mirror node**; `AccountBalanceQuery` is deprecated.
- The mirror node lags consensus by a few seconds, so the demos poll briefly after writing.
- Don't name a package script `setup`: `pnpm --filter <pkg> setup` runs pnpm's own built-in
  `setup` (it installs pnpm globally and edits your shell profile). Ours is `testnet-setup`.
- **Fee estimates can come back in tinybars.** Hashio occasionally reports a block's base fee
  1e10 times too small (126 instead of 1.26e12), so viem prices a transaction below the network
  minimum and it's refused. `hederaTestnet` from `@app/mandates` prices from `eth_gasPrice`,
  scaled up if that is in tinybars too (`packages/mandates/src/chain.ts`).

## Live test (testnet, 6 Nov 2026)

| Check | Result |
|---|---|
| Setup: operator opted in to USDC | [tx](https://hashscan.io/testnet/transaction/0.0.11328004@1793904237.910153621) |
| Relayer and log writer accounts | [0.0.11328382](https://hashscan.io/testnet/account/0.0.11328382), [0.0.11328384](https://hashscan.io/testnet/account/0.0.11328384) |
| Public log, no admin key, only the log writer may write | [0.0.11328386](https://hashscan.io/testnet/topic/0.0.11328386) |
| Log writer writes entry #1, read back from the mirror | [tx](https://hashscan.io/testnet/transaction/0.0.11328384@1793904254.626118567) |
| Operator tries to write to the log | refused: `INVALID_SIGNATURE` |
| Operator pays 0.01 USDC to a new account, arrives | [tx](https://hashscan.io/testnet/transaction/0.0.11328004@1793904393.437736251) |
| Relayer tries to move the operator's USDC | refused: `INVALID_SIGNATURE` |
