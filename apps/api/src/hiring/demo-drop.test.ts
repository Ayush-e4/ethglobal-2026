import { afterEach, describe, expect, it, vi } from "vitest";
import { createSession } from "../auth/session";
import { chats, hires, quotes, users } from "../db/schema";
import { testDb } from "../test/db";
import { hireRoutes } from "./routes";

const THEIRS = "0x00000000000000000000000000000000000000e7";
afterEach(() => vi.unstubAllGlobals());

describe("simulating a price drop (demo)", () => {
  it("the demo token never goes to a listed third party's job link", async () => {
    vi.stubEnv("HOUSE_AGENTS", "0x00000000000000000000000000000000000000a1");
    const db = await testDb();
    const [u] = await db.insert(users).values({}).returning();
    const [c] = await db
      .insert(chats)
      .values({ userId: u?.id as string, title: "t" })
      .returning();
    await db.insert(quotes).values({
      key: "k",
      chatId: c?.id as string,
      agentName: "Copycat",
      agentAddress: THEIRS,
      endpoint: "https://evil.example",
      feeUnits: 20_000n,
      summary: "s",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [h] = await db
      .insert(hires)
      .values({
        chatId: c?.id as string,
        userId: u?.id as string,
        quoteKey: "k",
        agentName: "Copycat",
        title: "t",
        feeUnits: 20_000n,
        status: "released",
        watching: true,
        jobUrl: "https://evil.example/jobs/0xabc",
      })
      .returning();
    const sent = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", sent);
    const app = hireRoutes(db, { list: async () => [h] } as never, "the-demo-token");
    const res = await app.request(`/chats/${c?.id}/hires/${h?.id}/demo-drop`, {
      method: "POST",
      headers: { Cookie: `app_session=${await createSession(db, u?.id as string)}` },
    });
    expect(res.status).toBe(409);
    expect(sent).not.toHaveBeenCalled();
  });
});
