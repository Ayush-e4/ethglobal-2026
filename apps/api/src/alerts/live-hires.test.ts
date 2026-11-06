import type { Rating } from "@app/arkiv";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "../db/client";
import { alertChannels, chats, hires, quotes, users } from "../db/schema";
import { testDb } from "../test/db";
import { worldRatings } from "../world/ratings";
import { liveHires } from "./live-hires";
import { telegramAlerts } from "./telegram";

type Call = { method: string; body: Record<string, unknown> };
type Row = { text: string; callback_data?: string; url?: string; style?: string }[];

async function setup(o: { photoFails?: boolean; image?: string | null } = {}) {
  const db: Db = await testDb();
  const calls: Call[] = [];
  let id = 100;
  const fetchImpl = (async (url: string, init: { body: string }) => {
    const method = url.split("/").at(-1) ?? "";
    calls.push({ method, body: JSON.parse(init.body) });
    if (method === "sendPhoto" && o.photoFails)
      return Response.json({ ok: false, description: "wrong file" });
    return Response.json({ ok: true, result: { message_id: ++id } });
  }) as unknown as typeof fetch;
  const t = telegramAlerts(db, "123:test", fetchImpl);
  const [user] = await db.insert(users).values({}).returning();
  if (!user) throw new Error("no user");
  await db.insert(alertChannels).values({ userId: user.id, telegramChatId: "42" });
  const [chat] = await db.insert(chats).values({ userId: user.id, title: "Goa" }).returning();
  if (!chat) throw new Error("no chat");
  const key = `0x${"ab".repeat(32)}`;
  await db.insert(quotes).values({
    key,
    chatId: chat.id,
    agentName: "PriceGuard",
    agentAddress: `0x${"11".repeat(20)}`,
    endpoint: "http://localhost:8802",
    feeUnits: 50_000n,
    summary: "Park Inn · 20–22 Dec",
    image: o.image === undefined ? "https://photos.example/park-inn.jpg" : o.image,
    expiresAt: new Date(),
  });
  let clock = Date.parse("2026-11-06T05:00:00Z");
  const [hire] = await db
    .insert(hires)
    .values({
      chatId: chat.id,
      userId: user.id,
      quoteKey: key,
      agentName: "PriceGuard",
      title: "Park Inn · 20–22 Dec",
      feeUnits: 50_000n,
      status: "held",
      escrowId: `0x${"e5".repeat(32)}`,
      payTx: "0.0.11328382@1793936488.549097829",
      undoUntil: new Date(clock + 60_000),
    })
    .returning();
  if (!hire) throw new Error("no hire");
  const cancelled: string[] = [];
  const posted: Rating[] = [];
  const ratings = worldRatings(db, {
    secret: "s",
    post: async (r) => {
      posted.push(r);
      return { entityKey: `0x${"0e".repeat(32)}`, txHash: `0x${"0f".repeat(32)}` };
    },
  });
  const live = liveHires({
    db,
    t,
    appOrigin: "http://localhost:3000",
    cancel: async (_u, _c, hireId) => {
      cancelled.push(hireId);
      await db.update(hires).set({ status: "cancelled" }).where(eq(hires.id, hireId));
    },
    ratings,
    now: () => clock,
    log: () => {},
  });
  const set = (changes: Partial<typeof hire>) =>
    db.update(hires).set(changes).where(eq(hires.id, hire.id));
  const rows = (c?: Call) =>
    ((c?.body.reply_markup as { inline_keyboard: Row[] }) ?? { inline_keyboard: [] })
      .inline_keyboard;
  const tap = (data: string, chatId = 42) =>
    live.onCallback({ id: "cb1", data, message: { chat: { id: chatId }, message_id: 101 } });
  return {
    db,
    live,
    hire,
    user,
    calls,
    cancelled,
    posted,
    set,
    rows,
    tap,
    later: (ms: number) => {
      clock += ms;
    },
  };
}

describe("a hire, live in Telegram", () => {
  it("one message with the hotel's photo, an Undo button and the payment", async () => {
    const { live, hire, calls, rows } = await setup();
    await live.show(hire.id);
    expect(calls).toHaveLength(1);
    const [sent] = calls;
    expect(sent?.method).toBe("sendPhoto");
    expect(sent?.body).toMatchObject({
      chat_id: "42",
      photo: "https://photos.example/park-inn.jpg",
      parse_mode: "HTML",
    });
    expect(sent?.body.caption).toMatch(/^<b>Park Inn · 20–22 Dec<\/b>\nPriceGuard · fee 0.05 USDC/);
    expect(sent?.body.caption).toMatch(/You can undo until \d\d:\d\d:\d\d/);
    expect(rows(sent)).toEqual([
      [{ text: "↩ Undo", callback_data: `undo:${hire.id}`, style: "danger" }],
      [
        {
          text: "Payment",
          url: "https://hashscan.io/testnet/transaction/0.0.11328382@1793936488.549097829",
        },
      ],
    ]); // no "Open chat": Telegram refuses localhost links
  });

  it("edited in place as the hire moves on, and left alone when nothing changed", async () => {
    const { live, hire, calls, set, rows, later } = await setup();
    await live.show(hire.id);
    await live.show(hire.id);
    expect(calls).toHaveLength(1); // nothing changed
    later(61_000); // the undo window is over
    await live.show(hire.id);
    expect(calls.at(-1)?.method).toBe("editMessageCaption");
    expect(calls.at(-1)?.body.caption).toMatch(/PriceGuard is booking it now/);
    expect(
      rows(calls.at(-1))
        .flat()
        .some((b) => b.text === "↩ Undo"),
    ).toBe(false);
    await set({ status: "delivered", bookingRef: "LiugdfvpL", watchNote: "Saved ₹800 · 1 rebook" });
    await live.show(hire.id);
    expect(calls.at(-1)?.body).toMatchObject({ message_id: 101 });
    expect(calls.at(-1)?.body.caption).toMatch(
      /Booked, reference <code>LiugdfvpL<\/code>[\s\S]*📉 Saved ₹800/,
    );
    expect(rows(calls.at(-1))[0]?.map((b) => b.text)).toEqual(["1★", "2★", "3★", "4★", "5★"]);
  });

  it("Undo from Telegram works only from the owner's linked chat", async () => {
    const { live, hire, calls, cancelled, tap } = await setup();
    await live.show(hire.id);
    await tap(`undo:${hire.id}`, 99);
    expect(cancelled).toHaveLength(0);
    expect(calls.at(-1)).toMatchObject({
      method: "answerCallbackQuery",
      body: { show_alert: true },
    });
    await tap(`undo:${hire.id}`);
    expect(cancelled).toEqual([hire.id]);
    expect(
      calls.find(
        (c) => c.method === "answerCallbackQuery" && c.body.text === "Undone: nothing was booked.",
      ),
    ).toBeTruthy();
    expect(calls.at(-1)?.body.caption).toMatch(/↩ Undone/);
  });

  it("rating from Telegram counts only from a verified person", async () => {
    const { db, live, hire, user, calls, posted, set, rows, tap } = await setup();
    await set({ status: "released", bookingRef: "LiugdfvpL" });
    await live.show(hire.id);
    await tap(`rate:${hire.id}:5`);
    expect(posted).toHaveLength(0);
    expect(calls.at(-1)?.body.text).toMatch(/only from verified people/);
    await db
      .update(users)
      .set({ worldIss: "https://sandbox.auth.world.org", worldSub: "human-1" })
      .where(eq(users.id, user.id));
    await tap(`rate:${hire.id}:5`);
    expect(posted[0]).toMatchObject({ score: 5, verified: "world-id" });
    const last = calls.at(-1);
    expect(last?.body.caption).toMatch(/You rated PriceGuard 5\/5/);
    expect(rows(last)[0]?.[4]).toMatchObject({ text: "5★", style: "success" });
  });

  it("no photo, or one Telegram can't load: a text message, edited as text", async () => {
    const { live, hire, calls, later } = await setup({ photoFails: true });
    await live.show(hire.id);
    expect(calls.map((c) => c.method)).toEqual(["sendPhoto", "sendMessage"]);
    later(61_000);
    await live.show(hire.id);
    expect(calls.at(-1)?.method).toBe("editMessageText");
  });

  it("nothing goes out without a linked Telegram chat", async () => {
    const { db, live, hire, user, calls } = await setup();
    await db
      .update(alertChannels)
      .set({ telegramChatId: null })
      .where(eq(alertChannels.userId, user.id));
    await live.show(hire.id);
    expect(calls).toHaveLength(0);
  });
});
