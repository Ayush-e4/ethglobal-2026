// A hotel agent: `staywise` (book it, done) or `priceguard` (book and keep watching).
// Run: pnpm --filter @app/agents dev (StayWise) or pnpm --filter @app/agents priceguard
import { serve } from "@hono/node-server";
import { HOTEL_AGENTS, type HotelAgentId, loadHotelAgentConfig } from "./config";
import { startHotelAgent } from "./service";

const id = (process.argv[2] ?? "staywise") as HotelAgentId;
if (!(id in HOTEL_AGENTS)) throw new Error(`unknown agent ${id}: ${Object.keys(HOTEL_AGENTS)}`);
const config = loadHotelAgentConfig(id);
const { app, agent } = await startHotelAgent(config);
serve({ fetch: app.fetch, port: config.port }, () =>
  console.log(`${config.name} (${agent.address}) on ${config.publicUrl}`),
);
