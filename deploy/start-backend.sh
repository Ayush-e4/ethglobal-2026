#!/usr/bin/env bash
# The API, the x402 facilitator and our four agents, in one container. The agents list
# themselves on Arkiv at localhost addresses, which the API reaches here. If any process stops,
# the container stops and Docker starts it again. The agents' files (jobs, quotes, ERC-8004 ids)
# are on a volume, so a deploy keeps them.
set -euo pipefail
cd /app/apps/facilitator && pnpm exec tsx src/index.ts &
sleep 2
cd /app/apps/agents
pnpm exec tsx src/hotels/main.ts staywise &
pnpm exec tsx src/hotels/main.ts priceguard &
pnpm exec tsx src/flights/main.ts &
pnpm exec tsx src/lookups/main.ts &
cd /app/apps/api && pnpm exec tsx src/index.ts &
wait -n
echo "a backend process stopped; restarting the container" >&2
exit 1
