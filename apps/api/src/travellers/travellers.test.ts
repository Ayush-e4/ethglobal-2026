import { describe, expect, it } from "vitest";
import { createSession } from "../auth/session";
import type { Db } from "../db/client";
import { chats, users } from "../db/schema";
import { testDb } from "../test/db";
import { travellerRoutes } from "./routes";
import { NeedsTraveller, parseGuest, travellerService } from "./service";

const ASHA = {
  firstName: "Asha",
  lastName: "Test",
  email: "asha@example.com",
  phone: "+91 98000 00001",
};
const guest = (n: number) => ({ ...ASHA, firstName: `Guest${n}`, email: `g${n}@example.com` });

async function setup() {
  const db: Db = await testDb();
  const t = travellerService(db);
  const app = travellerRoutes(db, t);
  const account = async () => {
    const [u] = await db.insert(users).values({}).returning();
    if (!u) throw new Error("no user");
    const [chat] = await db.insert(chats).values({ userId: u.id, title: "Goa" }).returning();
    if (!chat) throw new Error("no chat");
    return { user: u, chat, cookie: `app_session=${await createSession(db, u.id)}` };
  };
  const call = async (path: string, cookie: string, method = "GET", body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  return { db, t, account, call };
}

describe("saved travellers", () => {
  it("up to five, one of them 'me'", async () => {
    const { t, account } = await setup();
    const { user } = await account();
    const me = await t.add(user.id, ASHA, true);
    for (const n of [1, 2, 3, 4]) await t.add(user.id, guest(n), n === 2); // "me" moves to Guest2
    await expect(t.add(user.id, guest(5))).rejects.toThrow(/Up to 5/);
    const list = await t.list(user.id);
    expect(list).toHaveLength(5);
    expect(list.filter((x) => x.isSelf).map((x) => x.firstName)).toEqual(["Guest2"]);
    expect((await t.update(user.id, me.id, { ...ASHA, lastName: "Rao" })).lastName).toBe("Rao");
  });

  it("a chat's bookings are for its chosen traveller; until then, the booking asks", async () => {
    const { t, account } = await setup();
    const { user, chat } = await account();
    const gate = t.gate();
    const quote = {
      key: `0x${"ab".repeat(32)}`,
      agentName: "StayWise",
      summary: "Park Inn · 20–22 Dec",
    };
    const asked = await gate(user, chat.id, quote).catch((e) => e);
    expect(asked).toBeInstanceOf(NeedsTraveller);
    expect((asked as NeedsTraveller).card).toEqual({
      type: "traveller",
      agentName: "StayWise",
      reply: "Traveller chosen. Book Park Inn · 20–22 Dec (quote 0xabababab)",
    });
    expect(JSON.stringify((asked as NeedsTraveller).card)).not.toContain("@"); // no details on the card
    const asha = await t.add(user.id, ASHA);
    expect(await t.choose(user.id, chat.id, asha.id)).toBe(true);
    expect(await gate(user, chat.id, quote)).toEqual(ASHA);
    await t.remove(user.id, asha.id); // removing them: the chat asks again
    await expect(gate(user, chat.id, quote)).rejects.toThrow(NeedsTraveller);
  });

  it("nobody can choose someone else's traveller or chat", async () => {
    const { t, account } = await setup();
    const a = await account();
    const b = await account();
    const theirs = await t.add(b.user.id, ASHA);
    expect(await t.choose(a.user.id, a.chat.id, theirs.id)).toBe(false);
    const mine = await t.add(a.user.id, ASHA);
    expect(await t.choose(a.user.id, b.chat.id, mine.id)).toBe(false);
    expect(await t.remove(a.user.id, theirs.id)).toBe(false);
  });

  it("routes: list, add, change, remove, choose; checked details; 401 signed out", async () => {
    const { account, call } = await setup();
    const { chat, cookie } = await account();
    expect((await call("/travellers", cookie, "POST", { ...ASHA, email: "nope" })).status).toBe(
      400,
    );
    const added = await call("/travellers", cookie, "POST", { ...ASHA, isSelf: true });
    expect(added.status).toBe(201);
    const id = (added.json.traveller as { id: string }).id;
    expect(
      (await call(`/travellers/${id}`, cookie, "PATCH", { ...ASHA, phone: "+91 98000 00009" })).json
        .traveller,
    ).toMatchObject({ phone: "+91 98000 00009", isSelf: true });
    expect(
      (await call(`/chats/${chat.id}/traveller`, cookie, "POST", { travellerId: id })).status,
    ).toBe(200);
    expect((await call(`/chats/${chat.id}/traveller`, cookie)).json.traveller).toMatchObject({
      firstName: "Asha",
    });
    expect((await call("/travellers", cookie)).json).toMatchObject({
      max: 5,
      travellers: [{ id }],
    });
    expect((await call(`/travellers/${id}`, cookie, "DELETE")).status).toBe(200);
    expect((await call(`/chats/${chat.id}/traveller`, cookie)).json.traveller).toBeNull();
    expect((await call("/travellers", "")).status).toBe(401);
  });
});

describe("a guest typed in one message", () => {
  it.each([
    "Asha Test, asha@example.com, +91 98000 00001",
    "asha@example.com +91 98000 00001 Asha Test",
    "Asha Test; +91 98000 00001; asha@example.com",
  ])("reads %s", (text) => {
    expect(parseGuest(text)).toEqual(ASHA);
  });

  it.each([
    "Asha Test, asha@example.com, +91 98000 00001, 1990-05-14, F",
    "Asha Test female 14/05/1990 asha@example.com +91 98000 00001",
  ])("with a date of birth and gender, for flights: %s", (text) => {
    expect(parseGuest(text)).toEqual({ ...ASHA, bornOn: "1990-05-14", gender: "f" });
  });

  it("says what's missing", () => {
    expect(parseGuest("Asha, asha@example.com")).toEqual({
      error: "I need first and last name, a phone number",
    });
  });
});
