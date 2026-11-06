import type { Card } from "@app/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { ConciergeInput } from "../concierge/concierge";
import type { Db } from "../db/client";
import { alertChannels, chats, messages, users } from "../db/schema";
import { testDb } from "../test/db";
import { travellerService } from "../travellers/service";
import type { WorldCheck } from "../world/checks";
import { telegramAlerts } from "./telegram";
import { telegramChat } from "./telegram-chat";
import { cardMessages, chunks, html, quoteButton, slide } from "./telegram-format";

type Call = { method: string; body: Record<string, unknown> };
const KEY_A = `0x${"a1".repeat(32)}`;
const KEY_B = `0x${"b2".repeat(32)}`;
const offer = (key: string, title: string, img: string) => ({
  key,
  title,
  note: "",
  feeUnits: "20000",
  itemTotal: 11927,
  itemCurrency: "INR",
  reply: `Book ${title} (quote ${key.slice(0, 10)})`,
  images: [img],
  agentRating: { average: 5, count: 1 },
});
const QUOTES: Card = {
  type: "quotes",
  skill: "hotels",
  reason: "Each picked for a reason",
  quotes: [
    offer(KEY_A, "Park Inn · StayWise", "https://p/1.jpg"),
    offer(KEY_B, "DoubleTree · StayWise", "https://p/2.jpg"),
  ],
};

async function setup(o: { cards?: Card[]; check?: (n: number) => WorldCheck["status"] } = {}) {
  const db: Db = await testDb();
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: { body: string }) => {
    calls.push({ method: url.split("/").at(-1) ?? "", body: JSON.parse(init.body) });
    return Response.json({ ok: true, result: { message_id: 1 } });
  }) as unknown as typeof fetch;
  const t = telegramAlerts(db, "123:test", fetchImpl);
  const [user] = await db.insert(users).values({ isDemo: true }).returning();
  if (!user) throw new Error("no user");
  await db.insert(alertChannels).values({ userId: user.id, telegramChatId: "42" });
  const asked: string[] = [];
  let cards = o.cards ?? [];
  const concierge = vi.fn(async (input: ConciergeInput) => {
    asked.push(input.text);
    input.emit({ type: "status", label: "Looking at the market" });
    input.emit({ type: "text", delta: "Here are **two** " });
    input.emit({ type: "text", delta: "options." });
    const reply = { text: "Here are **two** options.", cards };
    cards = []; // later turns: just text
    return reply;
  });
  let polls = 0;
  const check = (status: WorldCheck["status"]): WorldCheck => ({
    id: "c1",
    userId: user.id,
    purpose: "spend",
    userCode: "ABCD-EFGH",
    link: "https://sandbox.auth.world.org/authorize?transaction_id=t1",
    expiresAt: Date.now() + 600_000,
    status,
  });
  const travellers = travellerService(db);
  const chat = telegramChat({
    db,
    t,
    concierge,
    appOrigin: "http://localhost:3000",
    approve: async () => ({ check: check("waiting") }),
    check: async () => check(o.check?.(++polls) ?? "verified"),
    travellers,
    wait: async () => {},
    log: () => {},
  });
  const sent = (method: string) => calls.filter((c) => c.method === method);
  return { db, user, calls, sent, chat, asked, concierge, travellers };
}

describe("the concierge in Telegram", () => {
  it("an unconnected chat is told how to connect", async () => {
    const { chat, sent, concierge } = await setup();
    await chat.turn("99", "hi");
    expect(sent("sendMessage")[0]?.body.text).toMatch(/Connect this chat first/);
    expect(concierge).not.toHaveBeenCalled();
  });

  it("streams the reply as a draft, then sends it, saved in an AgentNet chat", async () => {
    const { db, user, chat, sent } = await setup();
    await chat.turn("42", "A hotel in Goa for two, 20 to 22 December");
    const drafts = sent("sendMessageDraft").map((c) => c.body.text);
    expect(drafts[0]).toBe(""); // "Thinking…"
    expect(drafts).toContain("⏳ Looking at the market…");
    expect(sent("sendMessage").at(-1)?.body).toMatchObject({
      text: "Here are <b>two</b> options.",
      parse_mode: "HTML",
    });
    const [c] = await db.select().from(chats).where(eq(chats.userId, user.id));
    expect(c?.title).toBe("A hotel in Goa for two, 20 to 22 December");
    expect((await db.select().from(messages)).map((m) => m.role)).toEqual(["user", "assistant"]);
    await chat.turn("42", "cheaper?");
    expect(await db.select().from(chats)).toHaveLength(1); // the same conversation
    await chat.fresh("42");
    await chat.turn("42", "Now a hotel in Jaipur");
    expect(await db.select().from(chats)).toHaveLength(2); // /new: another one
  });

  it("offers come as one carousel: ◀ ▶ between hotels, then the pick; Book books", async () => {
    const { chat, sent, calls, asked } = await setup({ cards: [QUOTES] });
    await chat.turn("42", "A hotel in Goa");
    const [first, ...more] = sent("sendPhoto");
    expect(more).toEqual([]); // one message for all the hotels
    expect(first?.body).toMatchObject({ photo: "https://p/1.jpg" });
    expect(first?.body.caption).toMatch(
      /^<b>Park Inn<\/b>\n₹11,927[\s\S]*StayWise ★ 5\.0 \(1 verified\)/,
    );
    const rows = (
      first?.body.reply_markup as
        | { inline_keyboard: { text: string; callback_data: string }[][] }
        | undefined
    )?.inline_keyboard;
    expect(rows?.[0]?.map((b) => b.text)).toEqual(["◀", "Hotel 1 of 2", "▶"]);
    expect(rows?.[1]).toEqual([
      { text: "Book with StayWise · 0.02 USDC", callback_data: quoteButton(KEY_A) },
    ]);
    // The concierge's pick comes after the hotels.
    const order = calls
      .map((c) => c.method)
      .filter((m) => m === "sendPhoto" || m === "sendMessage");
    expect(order).toEqual(["sendPhoto", "sendMessage"]);
    // ▶ shows the next hotel in the same message.
    const next = rows?.[0]?.[2]?.callback_data ?? "";
    await chat.onCallback({
      id: "cb1",
      data: next,
      message: { chat: { id: 42 }, message_id: 7, photo: [{}] },
    });
    const turned = sent("editMessageMedia").at(-1)?.body;
    if (!turned) throw new Error("not turned");
    expect(turned).toMatchObject({
      message_id: 7,
      media: { type: "photo", media: "https://p/2.jpg" },
    });
    expect((turned.media as { caption: string }).caption).toMatch(/^<b>DoubleTree<\/b>/);
    const turnedRows = (turned.reply_markup as { inline_keyboard: { callback_data: string }[][] })
      .inline_keyboard;
    await chat.onCallback({
      id: "cb2",
      data: turnedRows[1]?.[0]?.callback_data ?? "",
      message: { chat: { id: 42 }, message_id: 7 },
    });
    expect(asked.at(-1)).toBe(`Book DoubleTree · StayWise (quote ${KEY_B.slice(0, 10)})`);
  });

  it("📷 steps through a hotel's own photos", () => {
    const many: Card = {
      ...QUOTES,
      quotes: [
        {
          ...offer(KEY_A, "Park Inn · StayWise", "https://p/1.jpg"),
          images: ["https://p/1.jpg", "https://p/1b.jpg"],
        },
      ],
    };
    if (many.type !== "quotes") throw new Error("quotes");
    const a = slide(many, 0, 0);
    expect(a.rows[0]?.[0]?.text).toBe("📷 Photo 1 of 2 ›"); // one hotel: no ◀ ▶
    expect(slide(many, 0, 1).photo).toBe("https://p/1b.jpg");
    expect(slide(many, 0, 2).photo).toBe("https://p/1.jpg"); // wraps around
  });

  it("a World ID approval opens from a button, and once it passes the booking carries on", async () => {
    const human: Card = {
      type: "human",
      agentName: "PriceGuard",
      feeUnits: "50000",
      quoteKey: KEY_A,
      reply: "Approved with World ID. Book Park Inn",
    };
    const { chat, sent, asked } = await setup({
      cards: [human],
      check: (n) => (n < 2 ? "waiting" : "verified"),
    });
    await chat.turn("42", "Book PriceGuard's Park Inn");
    const card = sent("sendMessage").find((c) =>
      String(c.body.text).includes("Confirm it's you with World ID"),
    );
    expect(card?.body.reply_markup).toEqual({
      inline_keyboard: [
        [
          {
            text: "Approve with World ID",
            url: "https://sandbox.auth.world.org/authorize?transaction_id=t1",
          },
        ],
      ],
    });
    await vi.waitFor(() => expect(asked.at(-1)).toBe("Approved with World ID. Book Park Inn"));
  });

  it("declined in World ID: nothing is paid, and it says so", async () => {
    const human: Card = {
      type: "human",
      agentName: "PriceGuard",
      feeUnits: "50000",
      quoteKey: KEY_A,
      reply: "Approved",
    };
    const { chat, sent, asked } = await setup({ cards: [human], check: () => "denied" });
    await chat.turn("42", "Book it");
    await vi.waitFor(() =>
      expect(sent("sendMessage").at(-1)?.body.text).toBe(
        "You declined in the World ID app. Nothing was paid.",
      ),
    );
    expect(asked).toEqual(["Book it"]);
  });

  it("one message at a time per chat", async () => {
    const { chat, sent } = await setup();
    await Promise.all([chat.turn("42", "first"), chat.turn("42", "second")]);
    expect(
      sent("sendMessage").some((c) => c.body.text === "Still on your last message: one moment."),
    ).toBe(true);
  });
});

describe("who a booking is for, in Telegram", () => {
  const WHO: Card = {
    type: "traveller",
    agentName: "StayWise",
    reply: "Traveller chosen. Book Park Inn",
  };
  const tap = (data: string) => ({ id: "cb", data, message: { chat: { id: 42 }, message_id: 1 } });

  it("someone new: their details are saved, never sent to the concierge, and the booking goes on", async () => {
    const { chat, sent, asked, travellers, user } = await setup({ cards: [WHO] });
    await chat.turn("42", "Book Park Inn");
    const ask = sent("sendMessage").find((c) =>
      String(c.body.text).includes("Who is this booking for?"),
    );
    expect(
      ((ask as Call).body.reply_markup as { inline_keyboard: { text: string }[][] })
        .inline_keyboard,
    ).toEqual([[{ text: "➕ Someone else", callback_data: "tv:new" }]]);
    await chat.onCallback(tap("tv:new"));
    expect(sent("sendMessage").at(-1)?.body.reply_markup).toMatchObject({ force_reply: true });
    await chat.turn("42", "Asha, asha@example.com"); // missing bits: asked again
    expect(sent("sendMessage").at(-1)?.body.text).toMatch(
      /I need first and last name, a phone number/,
    );
    await chat.turn("42", "Asha Test, asha@example.com, +91 98000 00001");
    expect(asked).toEqual(["Book Park Inn", "Traveller chosen. Book Park Inn"]); // never the details
    expect((await travellers.list(user.id)).map((t) => t.email)).toEqual(["asha@example.com"]);
  });

  it("a saved traveller is one tap", async () => {
    const { chat, sent, asked, travellers, user } = await setup({ cards: [WHO] });
    const asha = await travellers.add(
      user.id,
      { firstName: "Asha", lastName: "Test", email: "a@example.com", phone: "+91 98000 00001" },
      true,
    );
    await chat.turn("42", "Book Park Inn");
    const ask = sent("sendMessage").find((c) =>
      String(c.body.text).includes("Who is this booking for?"),
    );
    const rows = (
      (ask as Call).body.reply_markup as {
        inline_keyboard: { text: string; callback_data: string }[][];
      }
    ).inline_keyboard;
    expect(rows[0]?.[0]).toEqual({ text: "Asha T. (me)", callback_data: `tv:${asha.id}` });
    await chat.onCallback(tap(`tv:${asha.id}`));
    expect(asked.at(-1)).toBe("Traveller chosen. Book Park Inn");
  });
});
