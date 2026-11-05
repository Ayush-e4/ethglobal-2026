import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import { type PasskeySite, passkeyAuth, SignInError } from "./passkey";
import { rolesFor } from "./roles";
import { createSession, endSession, SESSION_COOKIE, SESSION_TTL_MS, userForToken } from "./session";

export interface AuthConfig {
  site: PasskeySite;
  adminUsers: ReadonlySet<string>;
  secureCookies: boolean; // https in production
}

/**
 * POST /auth/passkey/{register,login}-options → the device signs → POST /auth/passkey/{register,login}
 * POST /auth/demo: a demo account in one tap. POST /auth/logout. GET /me.
 */
export function authRoutes(db: Db, cfg: AuthConfig) {
  const passkey = passkeyAuth(db, cfg.site);
  const app = new Hono();
  const signIn = async (c: Context, userId: string) => {
    const token = await createSession(db, userId);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: cfg.secureCookies,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    });
  };
  const me = async (c: Context) => {
    const user = await userForToken(db, getCookie(c, SESSION_COOKIE));
    if (!user) return c.json({ error: "signed_out" }, 401);
    return c.json({
      id: user.id,
      isDemo: user.isDemo,
      displayName: user.displayName,
      roles: rolesFor(user, cfg.adminUsers),
    });
  };

  app.post("/auth/passkey/register-options", async (c) => {
    const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
    return c.json(await passkey.registrationOptions(body.name));
  });
  app.post("/auth/passkey/register", async (c) => {
    const body = await c.req.json<{ response: never; label?: string }>();
    const user = await passkey.register(body.response, body.label?.slice(0, 60) ?? null);
    await signIn(c, user.id);
    return c.json({ id: user.id });
  });
  app.post("/auth/passkey/login-options", async (c) =>
    c.json(await passkey.authenticationOptions()),
  );
  app.post("/auth/passkey/login", async (c) => {
    const user = await passkey.authenticate((await c.req.json<{ response: never }>()).response);
    await signIn(c, user.id);
    return c.json({ id: user.id });
  });
  app.post("/auth/demo", async (c) => {
    const [user] = await db.insert(users).values({ isDemo: true, displayName: "Demo" }).returning();
    if (!user) throw new Error("could not create the demo user");
    await signIn(c, user.id);
    return c.json({ id: user.id, isDemo: true });
  });
  app.post("/auth/logout", async (c) => {
    await endSession(db, getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
  app.get("/me", me);

  app.onError((err, c) => {
    if (err instanceof SignInError)
      return c.json({ error: "sign_in_failed", message: err.message }, 401);
    console.error(`auth: ${err.message}`);
    return c.json({ error: "internal" }, 500);
  });
  return app;
}
