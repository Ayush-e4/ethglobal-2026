import type { Card } from "@app/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { ConciergeInput } from "../concierge/concierge";
import type { Db } from "../db/client";
import { alertChannels, chats, messages, users } from "../db/schema";
import { testDb } from "../test/db";
import type { WorldCheck } from "../world/checks";
import { telegramAlerts } from "./telegram";
import { telegramChat } from "./telegram-chat";
import { cardMessages, chunks, html, quoteButton } from "./telegram-format";

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
  const chat = telegramChat({
    db,
    t,
    concierge,
    appOrigin: "http://localhost:3000",
    approve: async () => ({ check: check("waiting") }),
    check: async () => check(o.check?.(++polls) ?? "verified"),
    wait: async () => {},
    log: () => {},
  });
  const sent = (method: string) => calls.filter((c) => c.method === method);
  return { db, user, calls, sent, chat, asked, concierge };
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

  it("each hotel is one photo message with its details and a Book button, which books", async () => {
    const { chat, sent, asked } = await setup({ cards: [QUOTES] });
    await chat.turn("42", "A hotel in Goa");
    const photos = sent("sendPhoto");
    expect(photos.map((p) => p.body.photo)).toEqual(["https://p/1.jpg", "https://p/2.jpg"]);
    expect(photos[0]?.body.caption).toMatch(
      /^<b>Park Inn<\/b>\n₹11,927[\s\S]*StayWise ★ 5\.0 \(1 verified\)/,
    );
    const markup = photos[1]?.body.reply_markup as
      | { inline_keyboard: { callback_data: string }[][] }
      | undefined;
    const rows = markup?.inline_keyboard;
    expect(rows).toEqual([
      [{ text: "Book with StayWise · 0.02 USDC", callback_data: quoteButton(KEY_B) }],
    ]);
    await chat.onCallback({
      id: "cb",
      data: quoteButton(KEY_B),
      message: { chat: { id: 42 }, message_id: 1 },
    });
    expect(asked.at(-1)).toBe(`Book DoubleTree · StayWise (quote ${KEY_B.slice(0, 10)})`);
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

describe("Telegram formatting", () => {
  it("turns the concierge's Markdown into Telegram HTML, escaping the rest", () => {
    expect(html("**Park Inn** <3 & [map](https://m.example/a?b=1)\n- pool\n## Next")).toBe(
      '<b>Park Inn</b> &lt;3 &amp; <a href="https://m.example/a?b=1">map</a>\n• pool\n<b>Next</b>',
    );
  });

  it("the same hotel from two agents is one message, with a button for each way of working", () => {
    const twice: Card = {
      ...QUOTES,
      quotes: [
        { ...offer(KEY_A, "Park Inn · StayWise", "https://p/1.jpg"), model: "Book it, done" },
        {
          ...offer(KEY_B, "Park Inn · PriceGuard", "https://p/1.jpg"),
          model: "Book and keep watching",
          feeUnits: "50000",
        },
      ],
    };
    const [one, ...rest] = cardMessages(twice, null);
    expect(rest).toEqual([]);
    const markup = one?.body.reply_markup as { inline_keyboard: { text: string }[][] } | undefined;
    expect(markup?.inline_keyboard.map((r) => r[0]?.text)).toEqual([
      "StayWise: Book it, done · 0.02 USDC",
      "PriceGuard: Book and keep watching · 0.05 USDC",
    ]);
  });

  it("splits long replies on paragraph breaks", () => {
    const parts = chunks(["a".repeat(3000), "b".repeat(3000)].join("\n\n"));
    expect(parts.map((p) => p.length)).toEqual([3000, 3000]);
  });
});
