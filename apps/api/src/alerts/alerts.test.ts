import { describe, expect, it, vi } from "vitest";
import { createSession } from "../auth/session";
import { chatStore } from "../chats/store";
import type { Db } from "../db/client";
import { chats, messages, users } from "../db/schema";
import { testDb } from "../test/db";
import { alertingChats, alertRoutes } from "./routes";
import { handleUpdate, telegramAlerts } from "./telegram";

type Sent = { chat_id: string | number; text: string };

/** Telegram without Telegram: our bot is @agentnet_event_bot; every message sent is kept. */
function fakeTelegram() {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: string, init: { body: string }) => {
    const method = url.split("/").at(-1);
    if (method === "getMe")
      return Response.json({ ok: true, result: { username: "agentnet_event_bot" } });
    if (method === "sendMessage") sent.push(JSON.parse(init.body) as Sent);
    return Response.json({ ok: true, result: [] });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

async function setup(o: { noBot?: boolean } = {}) {
  const token = o.noBot ? undefined : "123:test";
  const db: Db = await testDb();
  const tg = fakeTelegram();
  const t = telegramAlerts(db, token, tg.fetchImpl);
  const account = async () => {
    const [u] = await db.insert(users).values({}).returning();
    if (!u) throw new Error("no user");
    return u.id;
  };
  /** The person taps the link's Start in Telegram, from chat `chatId`. */
  const tapStart = async (url: string | null, chatId: number) => {
    const code = new URL(url ?? "").searchParams.get("start");
    await handleUpdate(t, {
      update_id: 1,
      message: { chat: { id: chatId }, text: `/start ${code}` },
    });
  };
  return { db, t, account, tapStart, ...tg };
}

describe("Telegram alerts", () => {
  it("links with a one-time Start link, then sends alerts to that chat", async () => {
    const { t, account, tapStart, sent } = await setup();
    const me = await account();
    expect(await t.status(me)).toEqual({ available: true, linked: false });
    expect(await t.send(me, { title: "Goa", text: "Booked" })).toBe(false); // nowhere yet
    const url = await t.startLink(me);
    expect(url).toMatch(/^https:\/\/t\.me\/agentnet_event_bot\?start=[\w-]{16}$/);
    await tapStart(url, 42);
    expect(sent.at(-1)).toMatchObject({ chat_id: 42, text: expect.stringMatching(/^Connected/) });
    expect(await t.status(me)).toEqual({ available: true, linked: true });
    expect(await t.send(me, { title: "Goa", text: "Booked", url: "http://app/chat/1" })).toBe(true);
    expect(sent.at(-1)).toMatchObject({
      chat_id: "42",
      text: "Goa\n\nBooked\n\nhttp://app/chat/1",
    });
    // The link works once.
    await tapStart(url, 43);
    expect(sent.at(-1)?.text).toMatch(/expired or was used/);
  });

  it("one Telegram chat, one account: linking it again moves it", async () => {
    const { t, account, tapStart } = await setup();
    const a = await account();
    const b = await account();
    await tapStart(await t.startLink(a), 42);
    await tapStart(await t.startLink(b), 42);
    expect((await t.status(a)).linked).toBe(false);
    expect((await t.status(b)).linked).toBe(true);
  });

  it("/stop in Telegram stops them, and so does Disconnect in the app", async () => {
    const { t, account, tapStart, sent } = await setup();
    const me = await account();
    await tapStart(await t.startLink(me), 42);
    await handleUpdate(t, { update_id: 2, message: { chat: { id: 42 }, text: "/stop" } });
    expect(sent.at(-1)?.text).toMatch(/^Stopped/);
    expect(await t.send(me, { title: "Goa", text: "Booked" })).toBe(false);
    await tapStart(await t.startLink(me), 42);
    await t.unlink(me);
    expect((await t.status(me)).linked).toBe(false);
  });

  it("the app's own messages in a chat alert its owner, with a link back; people's don't", async () => {
    const { db, t, account, tapStart, sent } = await setup();
    const me = await account();
    await tapStart(await t.startLink(me), 42);
    const [chat] = await db
      .insert(chats)
      .values({ userId: me, title: "Goa, 20–22 Dec" })
      .returning();
    if (!chat) throw new Error("no chat");
    const store = alertingChats(db, chatStore(db), t, "https://app.example");
    const before = sent.length;
    await store.add(chat.id, "user", "book it");
    await store.add(chat.id, "assistant", "Booked: Park Inn. Booking reference LiugdfvpL.");
    await vi.waitFor(() => expect(sent).toHaveLength(before + 1));
    expect(sent.at(-1)).toEqual({
      chat_id: "42",
      text: `Booked: Park Inn. Booking reference LiugdfvpL.\n\nhttps://app.example/chat/${chat.id}`,
      disable_web_page_preview: true,
    });
    expect(await db.select().from(messages)).toHaveLength(2); // both kept in the chat
  });

  it("without a bot token, alerts are off and say so", async () => {
    const { db, t, account } = await setup({ noBot: true });
    const me = await account();
    expect(await t.status(me)).toEqual({ available: false, linked: false });
    expect(await t.startLink(me)).toBeNull();
    const cookie = `app_session=${await createSession(db, me)}`;
    const res = await alertRoutes(db, t).request("/alerts/telegram", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(503);
  });

  it("routes: status, a test alert, and 401 when signed out", async () => {
    const { db, t, account, tapStart, sent } = await setup();
    const me = await account();
    await tapStart(await t.startLink(me), 42);
    const app = alertRoutes(db, t);
    const cookie = `app_session=${await createSession(db, me)}`;
    expect(await (await app.request("/alerts", { headers: { Cookie: cookie } })).json()).toEqual({
      available: true,
      linked: true,
    });
    const test = await app.request("/alerts/test", { method: "POST", headers: { Cookie: cookie } });
    expect(await test.json()).toEqual({ sent: true });
    expect(sent.at(-1)?.text).toMatch(/^AgentNet\n\nAlerts work/);
    expect((await app.request("/alerts")).status).toBe(401);
  });
});
