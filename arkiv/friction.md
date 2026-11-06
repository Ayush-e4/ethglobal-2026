# Friction we hit with Arkiv

What got in our way while building Shikigami on Arkiv (SDK 1.0.1, Rabdi testnet). For each
item: what happened, what we did, and what would help.

## A patch changes the column, not the body

- **What happened:** We store each record's full JSON in a `body` column, plus a few indexed
  columns. Patching a job to `delivered` updated the indexed `status` column. The JSON body
  still said `paid`, so the first read back reported the old status.
- **What we did:** Reads take `status` from the indexed column, which wins over the body
  (`decodeRow` in `packages/arkiv/src/read.ts`).
- **What would help:** Say this prominently in the patch docs. Better still, offer a patch
  that updates a JSON field and its indexed copy together.

## The public endpoint is rate limited, and the key lives in the URL

- **What happened:** Without an access key, even a handful of reads failed with HTTP 429
  (`ANON_COST_LIMITED`). With a key, the key goes in the RPC URL's path. That makes the URL
  itself a secret, and any error that echoes the URL leaks it.
- **What we did:**
  - We always run with `ARKIV_ACCESS_KEY`, including in the query script.
  - Our writer turns every failure into a fixed error code and never passes provider text
    on (`SafeArkivWriter`).
- **What would help:** Accept the key in a header, so URLs and logs stay safe. Also give a
  small free anonymous allowance that survives a demo.

## No "latest per owner" query

- **What happened:** An agent's current profile or listing is simply its newest one. There's
  no query for "the newest entity per creator", so we fetch every listing for a skill and
  pick one per agent in code.
- **What we did:** We keep the record that expires last (`newestByAgent`). A republished
  listing wins because it expires later. Agents republish only when something changed
  (`keepListed`).
- **What would help:** A "latest per owner" or "group by creator" option, or ordering by
  creation block.

## Limits we designed around

| Limit | What we did |
|---|---|
| Lifetimes are capped at about 182 days | Ratings and disputes last 180 days, the longest we use. Anything meant to last longer would need renewing |
| Indexed text columns hold at most 128 bytes | Every indexed string is capped at 120 characters in validation |
| At most 100 results a page | The market's reads ask for 100. Fine at our scale; paging comes later |

## Expiry must line up with 2-second blocks

- **What happened:** Lifetimes are counted in blocks, and Rabdi's blocks are 2 seconds. An
  odd number of seconds isn't a whole block.
- **What we did:** Quote lifetimes are rounded down to an even number of seconds
  (`LIFETIME.quote`).
- **What would help:** Have the SDK round, or accept lifetimes in blocks directly.

## A read can lag a block behind a write

- **What happened:** An agent writes its quotes, then answers our request with their keys.
  When we read Arkiv straight away to check those quotes are really signed, the newest
  could be missing.
- **What we did:** If any are missing, the concierge and our review read once more after 2.5
  seconds before dropping an offer.
- **What would help:** A read-your-write option, or a documented "wait for the block"
  helper.

## Tooling and funding

- **The plugin's profile was out of date.** The Arkiv MCP plugin we had installed was on an
  old profile (SDK 0.8.1) while the current SDK is 1.0.x. Updating it fixed that, but we only
  noticed after its guidance didn't match the SDK.
- **A script can't fund a new agent wallet.** The faucet needs a wallet sign-in and a CAPTCHA.
  Each new agent wallet needs a little gas, so we fund new agents from our own writer wallet
  instead.

## What worked well

- **Typed schemas with only the filter columns indexed.** A small `body` of JSON for
  everything else kept records easy to evolve.
- **`$creator` as authorship.** It turned "who wrote this?" into one comparison, and it's the
  whole security model of our market.
- **Lifetimes as built-in cleanup.**
  - "Firm for 3 minutes" is enforced by the network, with no cron.
  - Listings fall off if an agent stops renewing them.
- **Batched creates.** A profile with its listing, or three quotes, go in one transaction.
- **The write-safety guidance.** The gas floor, the half-block cap, explicit nonces and "never
  resend automatically" were clear enough to put straight into code (`SafeArkivWriter`).
