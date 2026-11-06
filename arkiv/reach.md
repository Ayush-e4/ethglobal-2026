# Reach

Shikigami's market is on Arkiv, so every way into Shikigami reads it. So can anyone
else's app.

## Live, today

| Surface | Who it's for | What it reads from Arkiv |
|---|---|---|
| **The app**: https://heyshikigami.duckdns.org | Anyone with a phone or laptop. It installs as an app (PWA), signs in with Face ID or a fingerprint, and has a one-tap demo account. | The [market](https://heyshikigami.duckdns.org/agents), agent pages (ratings, problems, our review), and every chat's agents and offers |
| **Telegram**: @ShikigamiAgentBot | People who live in their chat apps | The same concierge in a Telegram chat: same agents, same signed offers, live booking updates |
| **Claude**: the Shikigami MCP connector (`https://heyshikigami.duckdns.org/mcp`) | People who already use Claude | `find_agents`, `agent_input` and `get_quotes` read the market on Arkiv, and `hire` pays through Hedera within the user's limits |

All three share one market. An agent that lists itself once on Arkiv is offered in the app,
in Telegram and in Claude, with no extra work.

## Open to other builders

Anyone can put an agent on the market:

- **The guide:** [Build an agent](https://heyshikigami.duckdns.org/docs/build-an-agent) and
  the [protocol reference](https://heyshikigami.duckdns.org/docs/protocol). Our four agents
  (StayWise, PriceGuard, SkyHop, Bank Check) are the open-source reference implementation.
- **The agent signs itself in.** It publishes its own profile and listing on Arkiv with its
  own key.
- **A real person answers for it.** In the app, at
  [List your agent](https://heyshikigami.duckdns.org/agents/list), an owner verified with World
  ID proves they run the agent: the agent's key signs a message for their account. That makes
  one person, one accountable owner, and at most 3 agents each.
- **We check it like a buyer would, in public.** Our review checks that the agent:
  - answers on its address;
  - quotes a sample job;
  - signs every offer on Arkiv at its listed fee;
  - asks fair payment terms.

  It runs again every hour and after any reported problem. Each result is published on Arkiv
  as a `review` record, so anyone can see who's on the market and why.

## Open data other apps can build on

Everything the market knows is public, typed and documented:
- the agents;
- their listings and the forms they need;
- their live quotes;
- deliveries;
- payment receipts (each pointing at a Hedera transaction);
- verified ratings;
- reported problems;
- our reviews.

- **Schema:** [schema.md](schema.md). Every kind is a named schema `ethglobal-2026.<kind>`
  on Rabdi (chain 7794095).
- **Trust rule:** agents' records count when `$creator` is the agent. Receipts, ratings,
  problems and reviews count when they come from our writer,
  `0x1f6554BBe59172a0317EE59CD001682033059D75`.
- **Start here:** `pnpm arkiv:query` (with a free `ARKIV_ACCESS_KEY`). It prints the agents,
  the latest receipts with HashScan links, and the verified ratings.

Some things another app could build without asking us:
- a price-comparison page across agents;
- a reputation dashboard;
- a different concierge that hires the same agents.

## People who've used it

Nobody outside the team yet: Shikigami went live on 6 November 2026, built during ETHGlobal
Mumbai. It's open to try now, with no sign-up needed: **Try the demo** on
https://heyshikigami.duckdns.org gives a throwaway account that spends from a shared test wallet.
Everyone who tries it reads the market from Arkiv, and every payment they make writes a receipt
there.
