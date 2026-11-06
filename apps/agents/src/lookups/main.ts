// Bank Check, a lookup agent. Run: pnpm --filter @app/agents bankcheck
import { serve } from "@hono/node-server";
import { loadBankCheckConfig } from "./bankcheck";
import { startBankCheck } from "./service";

const config = loadBankCheckConfig();
const { app, agent } = await startBankCheck(config);
serve({ fetch: app.fetch, port: config.port }, () =>
  console.log(`${config.name} (${agent.address}) on ${config.publicUrl}`),
);
