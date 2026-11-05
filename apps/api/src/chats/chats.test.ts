import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import type { Concierge } from "../concierge/concierge";
import { testDb } from "../test/db";

const ORIGIN = "http://localhost:3000";
const QUOTE_KEY = `0x${"ab".repeat(32)}`;

/** A concierge that streams a bit of text and one quotes card, and remembers what it was told. */
function fakeConcierge() {
  const seen: { history: unknown[]; text: string }[] = [];
  const concierge: Concierge = async ({ history, text, emit }) => {
    seen.push({ history, text });
    emit({ type: "status", label: "Asking hotel agents for live prices" });
    emit({ type: "text", delta: "Here are " });
    emit({ type: "text", delta: "two rooms." });
    const card = {
      type: "quotes" as const,
      skill: "hotels",
      reason: "Cheapest first",
      quotes: [
        {
          key: QUOTE_KEY,
          title: "Sea Breeze · StayWise",
          note: "Deluxe",
          feeUnits: "20000",
          itemTotal: 8400,
          itemCurrency: "INR",
          reply: "Book it",
        },
      ],
    };
    emit({ type: "card", card });
    return { text: "Here are two rooms.", cards: [card] };
  };
  return { concierge, seen };
}

type Json = { id: string; messages: { role: string; cards: { type: string }[] }[] };
const json = async (r: Response | Promise<Response>) => (await (await r).json()) as Json;

async function setup() {
  const fake = fakeConcierge();
  const app = createApp({
    appOrigin: ORIGIN,
    db: await testDb(),
    auth: {
      site: { rpID: "localhost", origin: ORIGIN, name: "AgentNet" },
      adminUsers: new Set(),
      secureCookies: false,
    },
    concierge: fake.concierge,
  });
  const signIn = async () =>
    (await app.request("/auth/demo", { method: "POST" })).headers
      .get("set-cookie")
      ?.split(";")[0] ?? "";
  const call = (path: string, cookie: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { "Content-Type": "application/json", Cookie: cookie } });
  return { app, signIn, call, fake };
}

const events = (body: string) =>
  body
    .split("\n\n")
    .map((b) =>
      b
        .split("\n")
        .find((l) => l.startsWith("data:"))
        ?.slice(5)
        .trim(),
    )
    .filter(Boolean)
    .map((d) => JSON.parse(d as string));

describe("chats", () => {
  it("streams the reply as events and saves both turns", async () => {
    const { call, signIn } = await setup();
    const me = await signIn();
    const chat = await json(
      call("/chats", me, { method: "POST", body: JSON.stringify({ title: "Goa trip" }) }),
    );
    const res = await call(`/chats/${chat.id}/messages`, me, {
      method: "POST",
      body: JSON.stringify({ text: "Hotel in Goa?" }),
    });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const got = events(await res.text());
    expect(got.map((e) => e.type)).toEqual(["status", "text", "text", "card", "done"]);

    const saved = await json(call(`/chats/${chat.id}`, me));
    expect(saved.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(saved.messages[1]?.cards[0]?.type).toBe("quotes");
  });

  it("the next turn remembers the quote keys it showed", async () => {
    const { call, signIn, fake } = await setup();
    const me = await signIn();
    const chat = await json(call("/chats", me, { method: "POST", body: "{}" }));
    await (
      await call(`/chats/${chat.id}/messages`, me, {
        method: "POST",
        body: JSON.stringify({ text: "Hotel?" }),
      })
    ).text();
    await (
      await call(`/chats/${chat.id}/messages`, me, {
        method: "POST",
        body: JSON.stringify({ text: "Book the first" }),
      })
    ).text();
    expect(JSON.stringify(fake.seen[1]?.history)).toContain(QUOTE_KEY);
  });

  it("chats are private to their owner", async () => {
    const { call, signIn } = await setup();
    const alice = await signIn();
    const bob = await signIn();
    const chat = await json(call("/chats", alice, { method: "POST", body: "{}" }));
    expect((await call(`/chats/${chat.id}`, bob)).status).toBe(404);
    expect(
      (
        await call(`/chats/${chat.id}/messages`, bob, {
          method: "POST",
          body: JSON.stringify({ text: "hi" }),
        })
      ).status,
    ).toBe(404);
    expect(await json(call("/chats", bob))).toEqual([]);
  });

  it("needs a session, and a non-empty message", async () => {
    const { call, signIn } = await setup();
    expect((await call("/chats", "")).status).toBe(401);
    const me = await signIn();
    const chat = await json(call("/chats", me, { method: "POST", body: "{}" }));
    expect(
      (
        await call(`/chats/${chat.id}/messages`, me, {
          method: "POST",
          body: JSON.stringify({ text: "  " }),
        })
      ).status,
    ).toBe(400);
  });
});
