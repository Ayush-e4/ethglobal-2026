import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { currentUser } from "../auth/current";
import type { Db } from "../db/client";
import { oauthClients, oauthGrants, oauthRequests, type User, users } from "../db/schema";

export const SCOPE = "agentnet";
const ACCESS_SECONDS = 3600;
const REFRESH_MS = 30 * 86_400_000;
const REQUEST_MS = 10 * 60_000;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const secret = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;
const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/** Where a connected app may send the user back: https, or this computer (for local tools). */
const RedirectUri = z
  .url()
  .max(500)
  .refine((u) => {
    const url = new URL(u);
    if (url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  }, "redirect URIs must be https (or http on localhost)");
const Register = z.object({
  redirect_uris: z.array(RedirectUri).min(1).max(5),
  client_name: z.string().max(100).optional(),
});

/** A fresh pair of tokens for a grant (only their hashes are stored). */
function tokens() {
  const access = secret("agn_at_");
  const refresh = secret("agn_rt_");
  return {
    access,
    refresh,
    row: {
      accessHash: hash(access),
      accessExpiresAt: new Date(Date.now() + ACCESS_SECONDS * 1000),
      refreshHash: hash(refresh),
      refreshExpiresAt: new Date(Date.now() + REFRESH_MS),
    },
  };
}
const issued = (t: ReturnType<typeof tokens>) => ({
  access_token: t.access,
  token_type: "Bearer",
  expires_in: ACCESS_SECONDS,
  refresh_token: t.refresh,
  scope: SCOPE,
});

/** The user and grant behind an `Authorization: Bearer` access token, or null. */
export async function bearerGrant(db: Db, authorization: string | undefined) {
  const token = /^Bearer (agn_at_[\w-]{20,})$/.exec(authorization ?? "")?.[1];
  if (!token) return null;
  const [row] = await db
    .select({ grant: oauthGrants, user: users })
    .from(oauthGrants)
    .innerJoin(users, eq(users.id, oauthGrants.userId))
    .where(
      and(
        eq(oauthGrants.accessHash, hash(token)),
        isNull(oauthGrants.revokedAt),
        gt(oauthGrants.accessExpiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return null;
  await db
    .update(oauthGrants)
    .set({ lastUsedAt: new Date() })
    .where(eq(oauthGrants.id, row.grant.id));
  return row as { grant: typeof row.grant; user: User };
}

/**
 * Connecting an app (Claude) to an account, with OAuth 2.1: it registers itself (dynamic client
 * registration), sends the user to /connect to say yes (signed in with their passkey), and swaps
 * the one-time code for tokens with PKCE. Everything is on the app's own origin.
 */
export function oauthRoutes(
  db: Db,
  appOrigin: string,
  onConnected?: (userId: string, app: string) => Promise<unknown>, // the security email
) {
  const app = new Hono();
  const open = cors({ origin: "*", allowHeaders: ["content-type", "authorization"] });
  app.use("/.well-known/*", open);
  app.use("/oauth/register", open);
  app.use("/oauth/token", open);

  const resourceMeta = {
    resource: `${appOrigin}/mcp`,
    authorization_servers: [appOrigin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Shikigami",
  };
  app.get("/.well-known/oauth-protected-resource", (c) => c.json(resourceMeta));
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json(resourceMeta));
  app.get("/.well-known/oauth-authorization-server", (c) =>
    c.json({
      issuer: appOrigin,
      authorization_endpoint: `${appOrigin}/oauth/authorize`,
      token_endpoint: `${appOrigin}/oauth/token`,
      registration_endpoint: `${appOrigin}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [SCOPE],
    }),
  );

  app.post("/oauth/register", async (c) => {
    const b = Register.safeParse(await c.req.json().catch(() => null));
    if (!b.success)
      return c.json(
        { error: "invalid_redirect_uri", error_description: b.error.issues[0]?.message },
        400,
      );
    const id = secret("agn_client_");
    const name = b.data.client_name?.trim() || "An app";
    await db.insert(oauthClients).values({ id, name, redirectUris: b.data.redirect_uris });
    return c.json(
      {
        client_id: id,
        client_name: name,
        redirect_uris: b.data.redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        client_id_issued_at: Math.floor(Date.now() / 1000),
      },
      201,
    );
  });

  app.get("/oauth/authorize", async (c) => {
    const q = c.req.query();
    const [client] = q.client_id
      ? await db.select().from(oauthClients).where(eq(oauthClients.id, q.client_id)).limit(1)
      : [];
    // Never redirect to an address the app didn't register.
    if (!client || !q.redirect_uri || !client.redirectUris.includes(q.redirect_uri))
      return c.text("Unknown app or return address.", 400);
    const back = new URL(q.redirect_uri);
    if (q.state) back.searchParams.set("state", q.state);
    if (q.response_type !== "code" || q.code_challenge_method !== "S256" || !q.code_challenge) {
      back.searchParams.set("error", "invalid_request");
      return c.redirect(back.toString());
    }
    const [req] = await db
      .insert(oauthRequests)
      .values({
        clientId: client.id,
        redirectUri: q.redirect_uri,
        state: q.state ?? null,
        codeChallenge: q.code_challenge,
        expiresAt: new Date(Date.now() + REQUEST_MS),
      })
      .returning();
    return c.redirect(`${appOrigin}/connect?req=${req?.id}`);
  });

  // The /connect page: what's asking, and the user's answer.
  const pending = async (id: string) => {
    if (!z.uuid().safeParse(id).success) return null;
    const [row] = await db
      .select({ req: oauthRequests, client: oauthClients })
      .from(oauthRequests)
      .innerJoin(oauthClients, eq(oauthClients.id, oauthRequests.clientId))
      .where(eq(oauthRequests.id, id))
      .limit(1);
    return row && !row.req.answeredAt && row.req.expiresAt > new Date() ? row : null;
  };
  app.get("/oauth/requests/:id", async (c) => {
    if (!(await currentUser(db, c))) return c.json({ error: "signed_out" }, 401);
    const row = await pending(c.req.param("id"));
    if (!row) return c.json({ error: "expired", message: "This request has expired." }, 410);
    return c.json({
      app: row.client.name,
      returnsTo: new URL(row.req.redirectUri).host,
      expiresAt: row.req.expiresAt.toISOString(),
    });
  });
  app.post("/oauth/requests/:id/answer", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const allow = z.object({ allow: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    const row = await pending(c.req.param("id"));
    if (!allow.success) return c.json({ error: "bad_request" }, 400);
    if (!row) return c.json({ error: "expired", message: "This request has expired." }, 410);
    const back = new URL(row.req.redirectUri);
    if (row.req.state) back.searchParams.set("state", row.req.state);
    const code = allow.data.allow ? secret("agn_c_") : null;
    await db
      .update(oauthRequests)
      .set({ answeredAt: new Date(), userId: user.id, codeHash: code ? hash(code) : null })
      .where(eq(oauthRequests.id, row.req.id));
    if (code) {
      back.searchParams.set("code", code);
      void onConnected?.(user.id, row.client.name).catch(() => {});
    } else back.searchParams.set("error", "access_denied");
    return c.json({ redirect: back.toString() });
  });

  app.post("/oauth/token", async (c) => {
    const type = c.req.header("content-type") ?? "";
    const b = (
      type.includes("json") ? await c.req.json().catch(() => ({})) : await c.req.parseBody()
    ) as Record<string, string | undefined>;
    const bad = (error: string, status: 400 | 401 = 400) => c.json({ error }, status);

    if (b.grant_type === "authorization_code") {
      if (!b.code || !b.code_verifier) return bad("invalid_request");
      const [req] = await db
        .select()
        .from(oauthRequests)
        .where(eq(oauthRequests.codeHash, hash(b.code)))
        .limit(1);
      if (
        !req?.userId ||
        req.usedAt ||
        req.expiresAt < new Date() ||
        (b.client_id && b.client_id !== req.clientId) ||
        (b.redirect_uri && b.redirect_uri !== req.redirectUri) ||
        s256(b.code_verifier) !== req.codeChallenge
      )
        return bad("invalid_grant");
      const used = await db
        .update(oauthRequests)
        .set({ usedAt: new Date() })
        .where(and(eq(oauthRequests.id, req.id), isNull(oauthRequests.usedAt)))
        .returning();
      if (used.length === 0) return bad("invalid_grant"); // swapped twice at once
      const t = tokens();
      await db.insert(oauthGrants).values({ clientId: req.clientId, userId: req.userId, ...t.row });
      return c.json(issued(t), 200, { "cache-control": "no-store" });
    }

    if (b.grant_type === "refresh_token") {
      if (!b.refresh_token) return bad("invalid_request");
      const [g] = await db
        .select()
        .from(oauthGrants)
        .where(eq(oauthGrants.refreshHash, hash(b.refresh_token)))
        .limit(1);
      if (
        !g ||
        g.revokedAt ||
        g.refreshExpiresAt < new Date() ||
        (b.client_id && b.client_id !== g.clientId)
      )
        return bad("invalid_grant");
      const t = tokens(); // both rotate: the old refresh token stops working
      await db.update(oauthGrants).set(t.row).where(eq(oauthGrants.id, g.id));
      return c.json(issued(t), 200, { "cache-control": "no-store" });
    }
    return bad("unsupported_grant_type");
  });

  return app;
}
