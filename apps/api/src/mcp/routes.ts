import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ToolDeps } from "../concierge/tools";
import type { Db } from "../db/client";
import type { HiringService } from "../hiring/service";
import { bearerGrant } from "./oauth";
import { agentnetMcp } from "./tools";

/**
 * AgentNet as a remote MCP server at /mcp (Streamable HTTP, stateless, JSON replies), for apps
 * the user connected with OAuth: Claude, for one. No token: 401, pointing at how to get one.
 */
export function mcpRoutes(
  db: Db,
  appOrigin: string,
  d: { tools: ToolDeps; hiring: HiringService },
) {
  const app = new Hono();
  app.use(
    "/mcp",
    cors({
      origin: "*",
      allowHeaders: ["content-type", "authorization", "mcp-protocol-version", "mcp-session-id"],
      exposeHeaders: ["www-authenticate", "mcp-session-id"],
    }),
  );
  const unauthorized = {
    "WWW-Authenticate": `Bearer resource_metadata="${appOrigin}/.well-known/oauth-protected-resource/mcp"`,
  };

  app.all("/mcp", async (c) => {
    const who = await bearerGrant(db, c.req.header("authorization"));
    if (!who) return c.json({ error: "invalid_token" }, 401, unauthorized);
    if (c.req.method !== "POST") return c.json({ error: "method_not_allowed" }, 405);
    const server = agentnetMcp(db, appOrigin, d, who);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless: every request stands alone
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
  return app;
}
