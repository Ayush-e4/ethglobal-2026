// The flight agent, SkyHop. Run: pnpm --filter @app/agents skyhop
import { serve } from "@hono/node-server";
import { loadFlightAgentConfig } from "./config";
import { startFlightAgent } from "./service";

const config = loadFlightAgentConfig();
const { app, agent } = await startFlightAgent(config);
serve({ fetch: app.fetch, port: config.port }, () =>
  console.log(`${config.name} (${agent.address}) on ${config.publicUrl}`),
);
