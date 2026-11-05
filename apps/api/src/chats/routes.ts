import { SendMessageSchema } from "@app/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { currentUser } from "../auth/current";
import type { Concierge } from "../concierge/concierge";
import type { Db } from "../db/client";
import { toHistory } from "./history";
import { chatStore } from "./store";

/**
 * POST /chats (start one), GET /chats, GET /chats/:id (with messages),
 * POST /chats/:id/messages: the user's text is saved first, then the reply streams as
 * Server-Sent Events (text deltas, cards, status) and is saved when it's complete.
 */
export function chatRoutes(db: Db, concierge: Concierge) {
  const store = chatStore(db);
  const app = new Hono();

  app.post("/chats", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const body = await c.req.json<{ title?: string }>().catch(() => ({}) as { title?: string });
    return c.json(await store.create(user.id, body.title?.trim() || "New chat"), 201);
  });

  app.get("/chats", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    return c.json(await store.list(user.id));
  });

  app.get("/chats/:id", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const chat = await store.get(user.id, c.req.param("id"));
    if (!chat) return c.json({ error: "not_found" }, 404);
    return c.json({ ...chat, messages: await store.messages(chat.id) });
  });

  app.post("/chats/:id/messages", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const chat = await store.get(user.id, c.req.param("id"));
    if (!chat) return c.json({ error: "not_found" }, 404);
    const body = SendMessageSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);

    const history = toHistory(await store.messages(chat.id));
    await store.add(chat.id, "user", body.data.text);
    c.header("Cache-Control", "no-cache, no-transform"); // proxies must not hold the stream back
    return streamSSE(c, async (sse) => {
      // Writes go out in order, and all of them before the stream closes.
      let writes = Promise.resolve();
      const emit = (event: unknown) => {
        writes = writes.then(() => sse.writeSSE({ data: JSON.stringify(event) }));
      };
      try {
        const reply = await concierge({
          context: { user, chatId: chat.id },
          history,
          text: body.data.text,
          emit,
          signal: c.req.raw.signal,
        });
        const saved = await store.add(chat.id, "assistant", reply.text, reply.cards);
        emit({ type: "done", messageId: saved.id });
      } catch (err) {
        console.error(`chat ${chat.id}: ${err instanceof Error ? err.message : err}`);
        await store.add(chat.id, "assistant", "Sorry, something went wrong. Please try again.");
        emit({ type: "error", message: "Something went wrong. Please try again." });
      }
      await writes;
    });
  });

  return app;
}
