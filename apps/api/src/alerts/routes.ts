import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { currentUser } from "../auth/current";
import type { ChatStore } from "../chats/store";
import type { Db } from "../db/client";
import { chats } from "../db/schema";
import type { TelegramAlerts } from "./telegram";

/**
 * The chat store, plus a phone alert to the chat's owner whenever the app writes in a chat on
 * its own (a booking, a refund, a cheaper rebook), with a link back to that chat. No heading: a
 * chat is named after its first message, which may be about another trip; the text says it all.
 */
export function alertingChats(
  db: Db,
  store: Pick<ChatStore, "add">,
  t: TelegramAlerts,
  appOrigin: string,
): Pick<ChatStore, "add"> {
  return {
    async add(chatId, role, text, cards) {
      const m = await store.add(chatId, role, text, cards);
      if (role === "assistant") {
        const [chat] = await db
          .select({ userId: chats.userId })
          .from(chats)
          .where(eq(chats.id, chatId));
        if (chat)
          void t
            .send(chat.userId, {
              text: text.length > 500 ? `${text.slice(0, 497)}…` : text,
              url: `${appOrigin}/chat/${chatId}`,
            })
            .catch(() => {});
      }
      return m;
    },
  };
}

/** GET /alerts, POST /alerts/telegram (a link to connect), POST /alerts/test, DELETE /alerts/telegram. */
export function alertRoutes(db: Db, t: TelegramAlerts) {
  const app = new Hono();

  app.get("/alerts", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    return c.json(await t.status(user.id));
  });

  app.post("/alerts/telegram", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const url = await t.startLink(user.id);
    return url
      ? c.json({ url })
      : c.json({ error: "Telegram alerts aren't set up on this server" }, 503);
  });

  app.post("/alerts/test", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const sent = await t.send(user.id, {
      title: "Shikigami",
      text: "Alerts work: you'll hear here when an agent books, refunds, or finds your room cheaper.",
    });
    return c.json({ sent });
  });

  app.delete("/alerts/telegram", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    await t.unlink(user.id);
    return c.json({ ok: true });
  });

  return app;
}
