import type { NextConfig } from "next";

// The browser only talks to this app: /api/* is forwarded to the Hono API, so cookies stay on
// one origin (no CORS, SameSite works as intended).
const API_URL = process.env.API_URL ?? "http://localhost:8787";
// Our agents, each at a public https address on this origin (/a/<agent>/…): the market review,
// any other app, and anyone reading their ERC-8004 cards reach them here.
const AGENTS_HOST = process.env.AGENTS_HOST ?? "http://localhost";
const AGENTS = { staywise: 8801, priceguard: 8802, skyhop: 8803, bankcheck: 8804 };

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@app/shared"],
  // A chat turn that books an agent pays first and can run past a minute; the default 30 s
  // proxy cut-off made the app show an error while the payment went through (and invited a retry).
  experimental: { proxyTimeout: 300_000 },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_URL}/:path*` },
      // Connecting apps (Claude) over MCP: OAuth and the MCP endpoint, on this origin.
      { source: "/mcp", destination: `${API_URL}/mcp` },
      { source: "/oauth/:path*", destination: `${API_URL}/oauth/:path*` },
      { source: "/.well-known/:path*", destination: `${API_URL}/.well-known/:path*` },
      ...Object.entries(AGENTS).flatMap(([name, port]) => [
        { source: `/a/${name}/:path*`, destination: `${AGENTS_HOST}:${port}/:path*` },
      ]),
    ];
  },
};

export default nextConfig;
