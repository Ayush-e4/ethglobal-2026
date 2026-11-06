import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createSession } from "../auth/session";
import type { ToolDeps } from "../concierge/tools";
import type { Db } from "../db/client";
import { chats, hires, messages, users } from "../db/schema";
import type { HiringService } from "../hiring/service";
import { testDb } from "../test/db";
import { oauthRoutes } from "./oauth";
import { mcpRoutes } from "./routes";

const ORIGIN = "https://app.example";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "a-long-random-pkce-verifier-that-only-the-app-knows-123456";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

async function setup() {
  const db: Db = await testDb();
  const [user] = await db.insert(users).values({}).returning();
  if (!user) throw new Error("no user");
  const cookie = `app_session=${await createSession(db, user.id)}`;
  const hired: string[] = [];
  const tools: ToolDeps = {
    market: { search: async () => ({ agents: [], matched: false, total: 0 }) } as never,
    saveQuotes: async () => {},
    hire: vi.fn(async (u, chatId, quoteKey) => {
      hired.push(quoteKey);
      const [h] = await db
        .insert(hires)
        .values({
          chatId,
          userId: u.id,
          quoteKey,
          agentName: "SkyHop",
          title: "Air India · BOM → GOI · 20 Dec",
          feeUnits: 30_000n,
          status: "held",
          undoUntil: new Date(Date.now() + 60_000),
        })
        .returning();
      return h as never;
    }),
  };
  const hiring = { cancel: vi.fn(async () => ({ title: "Air India · BOM → GOI · 20 Dec" })) };
  const oauth = oauthRoutes(db, ORIGIN);
  const mcp = mcpRoutes(db, ORIGIN, { tools, hiring: hiring as unknown as HiringService });
  return { db, user, cookie, oauth, mcp, hired, hiring };
}

/** Claude's side of connecting: register, send the user to say yes, swap the code for tokens. */
async function connect(s: Awaited<ReturnType<typeof setup>>) {
  const reg = await s.oauth.request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: [CALLBACK] }),
  });
  const { client_id } = (await reg.json()) as { client_id: string };
  const auth = await s.oauth.request(
    `/oauth/authorize?response_type=code&client_id=${client_id}&redirect_uri=${encodeURIComponent(CALLBACK)}&code_challenge=${CHALLENGE}&code_challenge_method=S256&state=xyz&scope=agentnet`,
  );
  const consent = new URL(auth.headers.get("location") ?? "");
  const req = consent.searchParams.get("req") ?? "";
  const shown = (await (
    await s.oauth.request(`/oauth/requests/${req}`, { headers: { Cookie: s.cookie } })
  ).json()) as Record<string, unknown>;
  const answer = (await (
    await s.oauth.request(`/oauth/requests/${req}/answer`, {
      method: "POST",
      headers: { Cookie: s.cookie, "content-type": "application/json" },
      body: JSON.stringify({ allow: true }),
    })
  ).json()) as { redirect: string };
  const back = new URL(answer.redirect);
  const token = (code: string, verifier = VERIFIER) =>
    s.oauth.request("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id,
        redirect_uri: CALLBACK,
      }).toString(),
    });
  return { client_id, consent, shown, back, token };
}

const rpc = (mcp: Awaited<ReturnType<typeof setup>>["mcp"], token: string | null, body: unknown) =>
  mcp.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
const call = async (mcp: Parameters<typeof rpc>[0], token: string, name: string, args = {}) => {
  const r = (await (
    await rpc(mcp, token, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    })
  ).json()) as { result: { content: { text: string }[]; isError?: boolean } };
  return r.result;
};

describe("connecting Claude (OAuth)", () => {
  it("register → the user says yes → code + PKCE → tokens; codes work once", async () => {
    const s = await setup();
    const c = await connect(s);
    expect(c.consent.origin + c.consent.pathname).toBe(`${ORIGIN}/connect`);
    expect(c.shown).toMatchObject({ app: "Claude", returnsTo: "claude.ai" });
    expect(c.back.searchParams.get("state")).toBe("xyz");
    const code = c.back.searchParams.get("code") ?? "";
    expect((await c.token(code, "the-wrong-verifier-the-wrong-verifier-000000")).status).toBe(400);
    const ok = await c.token(code);
    expect(ok.status).toBe(200);
    const t = (await ok.json()) as { access_token: string; refresh_token: string };
    expect(t.access_token).toMatch(/^agn_at_/);
    expect((await c.token(code)).status).toBe(400); // used
    // Refresh rotates both tokens: the old refresh token stops working.
    const refresh = (rt: string) =>
      s.oauth.request("/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: rt }),
      });
    expect((await refresh(t.refresh_token)).status).toBe(200);
    expect((await refresh(t.refresh_token)).status).toBe(400);
  });

  it("never sends the user to an address the app didn't register", async () => {
    const s = await setup();
    const reg = await s.oauth.request("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: [CALLBACK] }),
    });
    const { client_id } = (await reg.json()) as { client_id: string };
    const r = await s.oauth.request(
      `/oauth/authorize?response_type=code&client_id=${client_id}&redirect_uri=${encodeURIComponent("https://evil.example/cb")}&code_challenge=${CHALLENGE}&code_challenge_method=S256`,
    );
    expect(r.status).toBe(400);
    const http = await s.oauth.request("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }),
    });
    expect(http.status).toBe(400);
  });
});

describe("AgentNet over MCP", () => {
  it("asks for a token, pointing at how to get one", async () => {
    const s = await setup();
    const r = await rpc(s.mcp, null, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it("lists the tools, hires into the app's own chat, shows bookings, undoes; disconnecting stops it", async () => {
    const s = await setup();
    const c = await connect(s);
    const { access_token: token } = (await (
      await c.token(c.back.searchParams.get("code") ?? "")
    ).json()) as { access_token: string };

    const init = await rpc(s.mcp, token, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "t", version: "1" },
      },
    });
    expect(
      ((await init.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name,
    ).toBe("AgentNet");
    const list = (await (
      await rpc(s.mcp, token, { jsonrpc: "2.0", id: 2, method: "tools/list" })
    ).json()) as {
      result: { tools: { name: string }[] };
    };
    expect(list.result.tools.map((t) => t.name).sort()).toEqual([
      "agent_input",
      "bookings",
      "find_agents",
      "get_quotes",
      "hire",
      "undo",
    ]);

    expect(
      (await call(s.mcp, token, "find_agents", { need: "a flight" })).content[0]?.text,
    ).toMatch(/No agents/);
    const quote = `0x${"ab".repeat(32)}`;
    const hired = await call(s.mcp, token, "hire", { quote });
    expect(hired.content[0]?.text).toMatch(/^Hired\..*held in escrow, not paid/);
    expect(s.hired).toEqual([quote]);
    // It shows in the app's own chat, with the live card (undo, then the result).
    const [chat] = await s.db.select().from(chats).where(eq(chats.userId, s.user.id));
    expect(chat?.title).toBe("From Claude");
    const [m] = await s.db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chat?.id ?? ""));
    expect(m?.cards[0]).toMatchObject({ type: "hire" });

    const list2 = JSON.parse((await call(s.mcp, token, "bookings")).content[0]?.text ?? "[]");
    expect(list2[0]).toMatchObject({ agent: "SkyHop", status: "held", feeUsdc: "0.03" });
    expect(list2[0].receipt).toBe(`${ORIGIN}/receipts/${list2[0].booking}`);
    expect(
      (await call(s.mcp, token, "undo", { booking: list2[0].booking })).content[0]?.text,
    ).toMatch(/^Undone/);

    const grants = (await (
      await s.oauth.request("/oauth/grants", { headers: { Cookie: s.cookie } })
    ).json()) as { id: string }[];
    await s.oauth.request(`/oauth/grants/${grants[0]?.id}`, {
      method: "DELETE",
      headers: { Cookie: s.cookie },
    });
    expect((await rpc(s.mcp, token, { jsonrpc: "2.0", id: 3, method: "tools/list" })).status).toBe(
      401,
    );
  });
});
