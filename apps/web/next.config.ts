import type { NextConfig } from "next";

// The browser only talks to this app: /api/* is forwarded to the Hono API, so cookies stay on
// one origin (no CORS, SameSite works as intended).
const API_URL = process.env.API_URL ?? "http://localhost:8787";

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
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;
