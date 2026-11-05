// StayWise, the hotels agent. Run: pnpm --filter @app/agents dev
import { serve } from "@hono/node-server";
import { loadStayWiseConfig } from "./config";
import { startStayWise } from "./service";

const config = loadStayWiseConfig();
const { app, agent } = await startStayWise(config);
serve({ fetch: app.fetch, port: config.port }, () =>
  console.log(`StayWise (${agent.address}) on ${config.publicUrl}`),
);
