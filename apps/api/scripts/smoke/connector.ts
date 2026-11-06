// The Claude connector, as Claude meets it: OAuth (register, the user says yes, code + PKCE,
// tokens, refresh), the MCP tools, then disconnecting stops it.
import { createHash, randomBytes } from "node:crypto";
import { API, check, part, type Session } from "./http";

const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

export async function connectorRoutes(s: Session) {
  part("Claude connector (OAuth + MCP)");
  const reg = await s.expect("POST /oauth/register", 201, "POST", "/oauth/register", {
    client_name: "Smoke test",
    redirect_uris: [CALLBACK],
  });
  const client = reg.json?.client_id;
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const auth = await s.req(
    "GET",
    `/oauth/authorize?response_type=code&client_id=${client}&redirect_uri=${encodeURIComponent(CALLBACK)}&code_challenge=${challenge}&code_challenge_method=S256&state=smoke&scope=agentnet`,
  );
  const req = new URL(auth.headers.get("location") ?? "http://x").searchParams.get("req");
  check(
    "GET /oauth/authorize sends the user to /connect",
    auth.status === 302 && !!req,
    `${auth.status}`,
  );
  await s.expect("GET /oauth/requests/:id", 200, "GET", `/oauth/requests/${req}`);
  const yes = await s.expect(
    "POST /oauth/requests/:id/answer",
    200,
    "POST",
    `/oauth/requests/${req}/answer`,
    { allow: true },
  );
  const code = new URL(yes.json?.redirect ?? "http://x").searchParams.get("code") ?? "";
  const form = (b: Record<string, string>) =>
    fetch(`${API}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(b).toString(),
    }).then(async (r) => ({
      status: r.status,
      json: (await r.json().catch(() => ({}))) as Record<string, string>,
    }));
  const t = await form({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    client_id: client,
    redirect_uri: CALLBACK,
  });
  check(
    "POST /oauth/token: tokens for the code",
    t.status === 200 && !!t.json.access_token,
    `${t.status}`,
  );
  const r = await form({ grant_type: "refresh_token", refresh_token: t.json.refresh_token ?? "" });
  check(
    "POST /oauth/token: refresh rotates them",
    r.status === 200 && !!r.json.access_token,
    `${r.status}`,
  );
  const token = r.json.access_token ?? "";

  let id = 0;
  const rpc = async (method: string, params: object = {}, bearer = token) => {
    const res = await fetch(`${API}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      signal: AbortSignal.timeout(180_000),
    });
    // biome-ignore lint/suspicious/noExplicitAny: MCP results are read loosely here
    return { status: res.status, json: (await res.json().catch(() => ({}))) as { result?: any } };
  };
  const tool = async (name: string, args: object) =>
    String(
      (await rpc("tools/call", { name, arguments: args })).json.result?.content?.[0]?.text ?? "",
    );
  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "1" },
  });
  check("MCP initialize", init.json.result?.serverInfo?.name === "Shikigami");
  const names = ((await rpc("tools/list")).json.result?.tools ?? []).map(
    (x: { name: string }) => x.name,
  );
  check(
    "MCP tools/list",
    ["find_agents", "agent_input", "get_quotes", "hire", "ask_agent", "bookings", "undo"].every(
      (n) => names.includes(n),
    ),
    names.join(", "),
  );
  check(
    "MCP find_agents",
    (await tool("find_agents", { need: "check a bank IFSC code" })).includes("Bank Check"),
  );
  check("MCP agent_input", (await tool("agent_input", { skill: "bank-check" })).includes("ifsc"));
  // Its own chat has no lookup limit: it says to approve one in Shikigami, nothing is paid.
  check(
    "MCP ask_agent asks for a Face ID limit first",
    /approve a small lookup limit/.test(
      await tool("ask_agent", { skill: "bank-check", input: { ifsc: "HDFC0000240" } }),
    ),
  );
  check("MCP bookings", (await tool("bookings", {})).length > 0);

  const grants = (await s.req("GET", "/oauth/grants")).json as {
    id: string;
    name?: string;
    app?: string;
  }[];
  const mine = grants.find((g) => JSON.stringify(g).includes("Smoke test"));
  if (check("the app shows in Connected apps", !!mine) && mine) {
    await s.expect("DELETE /oauth/grants/:id", 200, "DELETE", `/oauth/grants/${mine.id}`);
    check("disconnected: MCP refuses its token", (await rpc("tools/list")).status === 401);
  }
}
