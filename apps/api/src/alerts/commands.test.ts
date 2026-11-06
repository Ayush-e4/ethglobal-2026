import { describe, expect, it } from "vitest";
import type { Db } from "../db/client";
import { alertChannels, chats, hires, users } from "../db/schema";
import { testDb } from "../test/db";
import { COMMANDS, HELP, setUpBotProfile, statusText } from "./commands";
import { handleUpdate, telegramAlerts } from "./telegram";

type Call = { method: string; body: Record<string, unknown> };

async function setup() {
  const db: Db = await testDb();
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: { body: string }) => {
    calls.push({ method: url.split("/").at(-1) ?? "", body: JSON.parse(init.body) });
    return Response.json({ ok: true, result: true });
  }) as unknown as typeof fetch;
  const t = telegramAlerts(db, "123:test", fetchImpl);
  const [user] = await db.insert(users).values({}).returning();
  if (!user) throw new Error("no user");
  await db.insert(alertChannels).values({ userId: user.id, telegramChatId: "42" });
  const [chat] = await db.insert(chats).values({ userId: user.id, title: "Goa" }).returning();
  const hire = (title: string, status: "held" | "released" | "cancelled", extra = {}) => ({
    chatId: chat?.id ?? "",
    userId: user.id,
    quoteKey: "k",
    agentName: title.startsWith("Park") ? "PriceGuard" : "StayWise",
    title,
    feeUnits: title.startsWith("Park") ? 50_000n : 20_000n,
    status,
    ...extra,
  });
  const send = (text: string, chatId = 42) =>
    handleUpdate(
      t,
      { update_id: 1, message: { chat: { id: chatId }, text } },
      {
        status: (id) => statusText(db, id),
      },
    );
  return { db, t, calls, hire, send };
}

describe("photos in Telegram", () => {
  it("downloads the photo (one to read, one thumbnail) and hands it over with its caption", async () => {
    const db: Db = await testDb();
    const got: string[] = [];
    const fetchImpl = (async (url: string, init?: { body?: string }) => {
      got.push(url.replace("123:test", "TOKEN"));
      if (url.endsWith("/getFile")) {
        const id = JSON.parse(init?.body ?? "{}").file_id as string;
        return Response.json({ ok: true, result: { file_path: `photos/${id}.jpg` } });
      }
      return new Response(new Uint8Array([1, 2, 3]));
    }) as unknown as typeof fetch;
    const t = telegramAlerts(db, "123:test", fetchImpl);
    const handed: unknown[] = [];
    await handleUpdate(
      t,
      {
        update_id: 1,
        message: {
          chat: { id: 7 },
          caption: "Watch this fare",
          photo: [
            { file_id: "s", width: 90, height: 60 },
            { file_id: "m", width: 320, height: 213 },
            { file_id: "x", width: 1280, height: 853 },
            { file_id: "huge", width: 2560, height: 1706 },
          ],
        },
      },
      { onText: async (...args) => handed.push(args) },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(handed).toEqual([
      [
        "7",
        "Watch this fare",
        {
          images: [{ mediaType: "image/jpeg", data: "AQID" }],
          thumbs: ["data:image/jpeg;base64,AQID"],
        },
      ],
    ]);
    expect(got.filter((u) => u.includes("/file/"))).toEqual([
      "https://api.telegram.org/file/botTOKEN/photos/x.jpg",
      "https://api.telegram.org/file/botTOKEN/photos/m.jpg",
    ]);
  });
});

describe("the bot's commands and profile", () => {
  it("sets its command menu and what people see before Start", async () => {
    const { t, calls } = await setup();
    await setUpBotProfile(t);
    expect(calls.map((c) => c.method).sort()).toEqual([
      "setMyCommands",
      "setMyDescription",
      "setMyShortDescription",
    ]);
    expect(calls.find((c) => c.method === "setMyCommands")?.body.commands).toEqual(COMMANDS);
  });

  it("/start without a link and /help explain the bot", async () => {
    const { calls, send } = await setup();
    await send("/start");
    await send("/help");
    expect(calls.map((c) => c.body.text)).toEqual([HELP, HELP]);
  });

  it("/status lists the linked account's bookings, newest first", async () => {
    const { db, calls, hire, send } = await setup();
    await db.insert(hires).values([
      hire("DoubleTree Goa · 27–29 Dec", "cancelled", { createdAt: new Date(Date.now() - 60_000) }),
      hire("Park Inn · 20–22 Dec", "released", {
        bookingRef: "CMYKh_7JC",
        watching: true,
        watchNote: "Saved ₹800 · 1 rebook",
      }),
    ]);
    await send("/status");
    expect(calls.at(-1)?.body.text).toBe(
      [
        "Your latest bookings (1 with the price watched):",
        "",
        "• Park Inn · 20–22 Dec · PriceGuard, 0.05 USDC: ✅ booked and paid (ref CMYKh_7JC)\n   📉 Saved ₹800 · 1 rebook",
        "• DoubleTree Goa · 27–29 Dec · StayWise, 0.02 USDC: ↩ undone",
      ].join("\n"),
    );
  });

  it("/status from a chat that isn't connected says how to connect", async () => {
    const { calls, send } = await setup();
    await send("/status", 99);
    expect(calls.at(-1)?.body.text).toMatch(/isn't connected/);
  });
});
