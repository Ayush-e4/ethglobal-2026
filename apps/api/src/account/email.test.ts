import { describe, expect, it } from "vitest";
import { createSession } from "../auth/session";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import { testDb } from "../test/db";
import { accountEmailOf, emailRoutes } from "./email";

describe("the account's email", () => {
  it("saves it, tests it, and says why a test didn't go", async () => {
    const db: Db = await testDb();
    const [u] = await db.insert(users).values({}).returning();
    if (!u) throw new Error("no user");
    const cookie = `app_session=${await createSession(db, u.id)}`;
    const tried: string[] = [];
    const app = emailRoutes(db, {
      available: true,
      tryEmail: async (e) => {
        tried.push(e.to);
        return { ok: false, error: "You can only send testing emails to your own email address" };
      },
      test: (to) => ({ to, subject: "t", html: "h", text: "t" }),
    });
    const call = (method: string, path: string, body?: unknown) =>
      app.request(path, {
        method,
        headers: { Cookie: cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    expect((await call("POST", "/account/email/test")).status).toBe(400); // none saved yet
    expect((await call("PUT", "/account/email", { email: "not an email" })).status).toBe(400);
    expect(
      await (await call("PUT", "/account/email", { email: " Me@Example.com " })).json(),
    ).toEqual({
      email: "me@example.com",
    });
    expect(await accountEmailOf(db)(u.id)).toBe("me@example.com");
    expect(await (await call("POST", "/account/email/test")).json()).toEqual({
      sent: false,
      error: "You can only send testing emails to your own email address",
    });
    expect(tried).toEqual(["me@example.com"]);
    expect((await call("POST", "/account/email/test")).status).toBe(429); // not twice in a row
  });
});
