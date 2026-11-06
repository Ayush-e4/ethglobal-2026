// Public routes and refusals: what anyone (or a signed-out visitor) can reach.
import { agentUrl, check, part, Session } from "./http";

export type Agent = { address: string; name: string; skill: string; kind?: string; url: string };

export async function publicRoutes(): Promise<Agent[]> {
  part("Public");
  const s = new Session();
  await s.expect("GET /health", 200, "GET", "/health");
  const list = await s.expect("GET /market/agents", 200, "GET", "/market/agents");
  const approved = (Array.isArray(list.json) ? list.json : []).filter(
    (a: { review?: { status?: string } }) => a.review?.status === "approved",
  );
  check(
    "approved agents on the market",
    approved.length >= 4,
    approved.map((a: Agent) => a.name).join(", "),
  );
  const agents: Agent[] = [];
  for (const a of approved as Agent[]) {
    const page = await s.expect(
      `GET /market/agents/:address (${a.name})`,
      200,
      "GET",
      `/market/agents/${a.address}`,
    );
    const url = agentUrl(page.json?.endpointHost ?? "");
    agents.push({ ...a, url });
    await s.expect(`${a.name}: GET /health`, 200, "GET", `${url}/health`);
    const card = await s.expect(
      `${a.name}: GET /.well-known/agent-card.json`,
      200,
      "GET",
      `${url}/.well-known/agent-card.json`,
    );
    check(
      `${a.name}: its ERC-8004 identity`,
      !!page.json?.erc8004 && card.json?.name === a.name,
      page.json?.erc8004 ? "" : "no identity on the page",
    );
  }
  const bank = agents.find((a) => a.kind === "lookup");
  if (check("a lookup agent is listed", !!bank) && bank) {
    await s.expect(
      `${bank.name}: unknown code is a 404, not charged`,
      404,
      "GET",
      `${bank.url}/answer?ifsc=SBIN0999999`,
    );
    const paid = await s.expect(
      `${bank.name}: a real code asks payment (402)`,
      402,
      "GET",
      `${bank.url}/answer?ifsc=HDFC0000240`,
    );
    check(`${bank.name}: x402 terms in the header`, !!paid.headers.get("payment-required"));
  }
  const fac = process.env.FACILITATOR_URL ?? "http://localhost:8790";
  await s.expect("facilitator: GET /supported", 200, "GET", `${fac}/supported`);
  for (const p of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-authorization-server",
  ])
    await s.expect(`GET ${p}`, 200, "GET", p);

  // Signed out: refused, and the connector says where to sign in.
  for (const p of ["/me", "/chats", "/trips", "/travellers", "/wallet", "/deals"])
    await s.expect(`signed out: GET ${p} is refused`, 401, "GET", p);
  const mcp = await s.req(
    "POST",
    "/mcp",
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    {
      accept: "application/json, text/event-stream",
    },
  );
  check(
    "signed out: POST /mcp asks for a token",
    mcp.status === 401 && !!mcp.headers.get("www-authenticate"),
  );
  await s.expect(
    "GET /receipts/:id for no such booking",
    404,
    "GET",
    "/receipts/00000000-0000-4000-8000-000000000000",
  );
  return agents;
}
