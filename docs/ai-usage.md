# AI usage log

ETHGlobal asks teams to document where AI tools were used. Every PR adds a row here.

| PR | Area | Tool | What AI did | What the team did |
|----|------|------|-------------|-------------------|
| bootstrap | Repo setup, CI, templates | Claude Code | Drafted the config files and CI | Chose the workflow rules, reviewed |
| skeleton | pnpm workspace, Turborepo, Biome; web (Next.js + Tailwind), API (Hono) with /health, shared package with exact USDC amounts; full CI | Claude Code | Scaffolded the workspace, apps and tests, checked lint, types, tests and build | Chose the stack and the look, reviewed |
| hedera basics | `@app/hedera`: one account per role, USDC payments, the public log with no admin key, setup and status scripts, roles doc | Claude Code | Wrote the package, scripts and tests; designed the role split and the checks that each role is refused outside its job | Asked for clear "who controls what" from the start, made the testnet account, reviewed |
