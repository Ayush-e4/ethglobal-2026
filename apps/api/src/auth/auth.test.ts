import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { testDb } from "../test/db";
import { softPasskey } from "../test/passkey";

const ORIGIN = "http://localhost:3000";
const site = { rpID: "localhost", origin: ORIGIN, name: "AgentNet" };

async function setup(adminUsers: string[] = []) {
  const app = createApp({
    appOrigin: ORIGIN,
    db: await testDb(),
    auth: { site, adminUsers: new Set(adminUsers), secureCookies: false },
    concierge: async () => ({ text: "", cards: [] }),
  });
  const call = (path: string, init: RequestInit & { cookie?: string } = {}) =>
    app.request(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.cookie ? { Cookie: init.cookie } : {}),
      },
    });
  const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";
  return { app, call, cookieOf };
}
type Json = { challenge: string; id: string; roles: string[] };
const json = async (r: Response | Promise<Response>) => (await (await r).json()) as Json;

describe("sign-in", () => {
  it("'Try the demo' signs in a demo account in one tap", async () => {
    const { call, cookieOf } = await setup();
    const res = await call("/auth/demo", { method: "POST" });
    expect(res.status).toBe(200);
    const cookie = cookieOf(res);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/);
    const me = await json(call("/me", { cookie }));
    expect(me).toMatchObject({ isDemo: true, roles: ["user"] });
  });

  it("signed out without a session, and after logging out", async () => {
    const { call, cookieOf } = await setup();
    expect((await call("/me")).status).toBe(401);
    const cookie = cookieOf(await call("/auth/demo", { method: "POST" }));
    await call("/auth/logout", { method: "POST", cookie });
    expect((await call("/me", { cookie })).status).toBe(401);
  });

  it("a passkey makes an account, then signs in to it", async () => {
    const { call, cookieOf } = await setup();
    const device = softPasskey(ORIGIN);
    const reg = await json(call("/auth/passkey/register-options", { method: "POST", body: "{}" }));
    const made = await call("/auth/passkey/register", {
      method: "POST",
      body: JSON.stringify({ response: device.register(reg.challenge), label: "iPhone" }),
    });
    expect(made.status).toBe(200);
    const { id } = await json(made);

    const opts = await json(call("/auth/passkey/login-options", { method: "POST" }));
    const login = await call("/auth/passkey/login", {
      method: "POST",
      body: JSON.stringify({ response: device.signIn(opts.challenge) }),
    });
    expect(login.status).toBe(200);
    const me = await json(call("/me", { cookie: cookieOf(login) }));
    expect(me).toMatchObject({ id, isDemo: false, displayName: "iPhone" });
  });

  it("a signed challenge can't be replayed", async () => {
    const { call } = await setup();
    const device = softPasskey(ORIGIN);
    const reg = await json(call("/auth/passkey/register-options", { method: "POST", body: "{}" }));
    await call("/auth/passkey/register", {
      method: "POST",
      body: JSON.stringify({ response: device.register(reg.challenge) }),
    });
    const opts = await json(call("/auth/passkey/login-options", { method: "POST" }));
    const answer = JSON.stringify({ response: device.signIn(opts.challenge) });
    expect((await call("/auth/passkey/login", { method: "POST", body: answer })).status).toBe(200);
    expect((await call("/auth/passkey/login", { method: "POST", body: answer })).status).toBe(401);
  });

  it("refuses a passkey from another site, and an unknown one", async () => {
    const { call } = await setup();
    const reg = await json(call("/auth/passkey/register-options", { method: "POST", body: "{}" }));
    const phishing = softPasskey("https://evil.test");
    const res = await call("/auth/passkey/register", {
      method: "POST",
      body: JSON.stringify({ response: phishing.register(reg.challenge) }),
    });
    expect(res.status).toBe(401);
    // The reason is in the answer (and the log), so a failed sign-up can be told apart.
    expect(((await res.json()) as { message: string }).message).toMatch(/origin/i);
    const opts = await json(call("/auth/passkey/login-options", { method: "POST" }));
    const stranger = softPasskey(ORIGIN);
    const login = await call("/auth/passkey/login", {
      method: "POST",
      body: JSON.stringify({ response: stranger.signIn(opts.challenge) }),
    });
    expect(login.status).toBe(401);
  });

  it("admins come from the server's settings only", async () => {
    const db = await testDb();
    const server = (admins: string[]) =>
      createApp({
        appOrigin: ORIGIN,
        db,
        auth: { site, adminUsers: new Set(admins), secureCookies: false },
        concierge: async () => ({ text: "", cards: [] }),
      });
    const demo = await server([]).request("/auth/demo", { method: "POST" });
    const { id } = await json(demo);
    const headers = { Cookie: demo.headers.get("set-cookie")?.split(";")[0] ?? "" };
    expect((await json(server([]).request("/me", { headers }))).roles).toEqual(["user"]);
    expect((await json(server([id]).request("/me", { headers }))).roles).toEqual(["user", "admin"]);
  });

  it("only the app's origin may call with cookies", async () => {
    const { app } = await setup();
    const ok = await app.request("/health", { headers: { Origin: ORIGIN } });
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const other = await app.request("/health", { headers: { Origin: "https://evil.test" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});
