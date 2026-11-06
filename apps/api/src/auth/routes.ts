import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { Db } from "../db/client";
import { passkeys, users } from "../db/schema";
import { type DeviceLinks, deviceLabel } from "./device-links";
import { type PasskeySite, passkeyAuth, SignInError } from "./passkey";
import { clientIp, rateLimit } from "./rate-limit";
import { rolesFor } from "./roles";
import { createSession, endSession, SESSION_COOKIE, SESSION_TTL_MS, userForToken } from "./session";

export interface AuthConfig {
  site: PasskeySite;
  adminUsers: ReadonlySet<string>;
  secureCookies: boolean; // https in production
}

/**
 * POST /auth/passkey/{register,login}-options → the device signs → POST /auth/passkey/{register,login}
 * POST /auth/passkey/link/options { code } → the new device signs → POST /auth/passkey/link: another
 * device for an existing account, with a code a signed-in device showed.
 * POST /auth/demo: a demo account in one tap. POST /auth/logout. GET /me.
 */
export function authRoutes(
  db: Db,
  cfg: AuthConfig,
  onSignUp?: (userId: string) => void,
  links?: DeviceLinks,
) {
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
    const label = body.label?.slice(0, 60) ?? deviceLabel(c.req.header("user-agent"));
    const user = await passkey.register(body.response, label);
    await signIn(c, user.id);
    onSignUp?.(user.id); // e.g. start making their Face ID wallet, without waiting for it
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
  // Another device for an existing account: it makes its own passkey with the code a signed-in
  // device showed, and is signed in. (Paying from the wallet needs Face ID on a trusted device.)
  const LinkCode = z.object({ code: z.string().min(8).max(16) });
  const GONE = "That code expired or was already used. Make a new one on your other device.";
  const linked = async (userId: string | null | undefined) =>
    userId ? (await db.select().from(users).where(eq(users.id, userId)))[0] : undefined;
  app.post("/auth/passkey/link/options", async (c) => {
    const body = LinkCode.safeParse(await c.req.json().catch(() => null));
    const user = await linked(body.success ? links?.peek(body.data.code) : null);
    if (!user) return c.json({ error: "link_gone", message: GONE }, 410);
    const keys = await db.select().from(passkeys).where(eq(passkeys.userId, user.id));
    const name = user.displayName ?? undefined;
    return c.json({ name: name ?? null, options: await passkey.registrationOptions(name, keys) });
  });
  app.post("/auth/passkey/link", async (c) => {
    const body = LinkCode.extend({ response: z.looseObject({}) }).safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const credential = await passkey.verifyNew(body.data.response as never);
    const user = await linked(links?.take(body.data.code));
    if (!user) return c.json({ error: "link_gone", message: GONE }, 410);
    await passkey.addDevice(user, credential, deviceLabel(c.req.header("user-agent")));
    await signIn(c, user.id);
    return c.json({ id: user.id });
  });
  // Demo accounts spend from one shared wallet: at most 30 new ones an hour per network address
  // (generous: judges at a venue share one address), so a script can't mint accounts to drain it.
  const demoSignups = rateLimit(30, 3600_000);
  app.post("/auth/demo", async (c) => {
    const ip = clientIp((n) => c.req.header(n));
    if (ip && !demoSignups(ip))
      return c.json(
        {
          error: "rate_limited",
          message: "Too many demo accounts from this network. Try again in a while.",
        },
        429,
      );
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
    if (err instanceof SignInError) {
      console.error(`auth: refused ${c.req.method} ${c.req.path}: ${err.message}`);
      return c.json({ error: "sign_in_failed", message: err.message }, 401);
    }
    console.error(`auth: ${err.message}`);
    return c.json({ error: "internal" }, 500);
  });
  return app;
}
