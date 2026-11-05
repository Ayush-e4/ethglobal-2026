import { serve } from "@hono/node-server";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 8787);
const app = createApp({ appOrigin: process.env.APP_ORIGIN ?? "http://localhost:3000" });

serve({ fetch: app.fetch, port }, () => console.log(`api on http://localhost:${port}`));
