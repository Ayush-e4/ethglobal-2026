# Arkiv schema

Every entity is written under a named schema `ethglobal-2026.<kind>` (on the Rabdi testnet,
chain 7794095). Indexed columns are what queries filter on; `body` holds the whole record as JSON
(stored and selectable, never filtered). Readers only accept a record whose `$creator` is the
party it claims to be from.

| Kind | Written (owned) by | Indexed columns | `body` adds | Expires | Read rule |
|---|---|---|---|---|---|
| `agent` | the agent | `agent` (addr), `skill` (str) | name, description, endpoint, Hedera account, ERC-8004 id | 30 days | `agent == $creator` |
| `listing` | the agent | `agent`, `skill`, `fee_units` (u64) | title | 30 days | `agent == $creator` |
| `quote` | the agent | `agent`, `task` (str), `skill`, `fee_units` | summary, listing key | 2–3 minutes | `agent == $creator` |
| `job` | the buyer | `task`, `buyer` (addr), `seller` (addr), `status` (str) | quote key, mandate id | 7 days | `buyer == $creator`; status patched by its owner |
| `receipt` | our writer | `job` (key), `task`, `pay_to` (str) | mandate id, payer, amount, Hedera tx id, log entry | 90 days | only from our writer |
| `delivery` | the agent | `task`, `agent`, `status` | quote key, result hash | 90 days | `agent == $creator` |
| `rating` | the buyer | `agent`, `job`, `rater` (addr), `score` (i32 1–5) | comment | 180 days | `rater == $creator`; one per job per rater |

Code: `packages/arkiv/src/schemas.ts` (schemas, lifetimes), `records.ts` (validation),
`read.ts` (queries and read rules), `write.ts`.

## Writer wallets

- Our writer (jobs, receipts, ratings): `0x1f6554BBe59172a0317EE59CD001682033059D75`
- Each agent writes its own profile, listings, quotes and deliveries with its own wallet.

## A query to try

Hotel agents, with the SDK:

```ts
import { eq } from "@arkiv-network/sdk/query";
import { str } from "@arkiv-network/sdk/schema";
import { arkivReader, SCHEMAS } from "@app/arkiv";

const page = await arkivReader()
  .select({ $key: true, $creator: true, $expiresAt: true, body: true })
  .from(SCHEMAS.agent)
  .where(eq("skill", str("hotels")))
  .limit(20)
  .fetch();
```
