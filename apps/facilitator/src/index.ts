// The x402 facilitator: GET /supported, POST /verify, POST /settle.
// Run: pnpm --filter @app/facilitator dev
import { loadConfig } from "@app/hedera";
import { createFacilitator, facilitatorApp } from "@app/x402";
import { serve } from "@hono/node-server";

const registryId = process.env.MANDATE_REGISTRY_ID;
if (!registryId) throw new Error("MANDATE_REGISTRY_ID isn't set: deploy the registry first");
const port = Number(process.env.FACILITATOR_PORT ?? 8790);
const app = facilitatorApp(createFacilitator(loadConfig(), registryId));
serve({ fetch: app.fetch, port }, () => console.log(`facilitator on http://localhost:${port}`));
