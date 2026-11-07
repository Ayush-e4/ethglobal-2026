import { type Card, SendMessageSchema } from "@app/shared";
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
/** Nudges someone that a slow reply is ready, when they left before it finished (Telegram). */
export type ReplyReady = (
  userId: string,
  chatId: string,
  title: string,
  reply: string,
) => Promise<unknown>;

/**
 * A reply made here, shown wherever else this chat is open (its Telegram chat): true if it was.
 * Then no nudge is needed.
 */
export type MirrorReply = (
  userId: string,
  chatId: string,
  said: string,
  reply: { text: string; cards: Card[] },
) => Promise<boolean>;

/** Only a reply someone waited a while for is worth a nudge. */
export const READY_AFTER_MS = 60_000;

export function chatRoutes(
  db: Db,
  concierge: Concierge,
  replyReady?: ReplyReady,
  readyAfterMs = READY_AFTER_MS,
  mirror?: MirrorReply,
) {
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
    const { text, images, thumbs } = body.data;
    // The photos' thumbnails stay with the message; Claude reads the full ones this turn only.
    await store.add(chat.id, "user", text, thumbs?.length ? [{ type: "photos", thumbs }] : []);
    const res = streamSSE(c, async (sse) => {
      // Writes go out in order, and all of them before the stream closes. A write to a reader
      // that left fails quietly: the turn still finishes and is saved.
      let writes = Promise.resolve();
      const write = (data: string, event?: string) => {
        writes = writes.then(() => sse.writeSSE({ data, event })).catch(() => {});
      };
      const emit = (event: unknown) => write(JSON.stringify(event));
      // Left before the reply was done (closed the tab, locked the phone): they'll be told.
      let away = false;
      const started = Date.now();
      sse.onAbort(() => {
        away = true;
      });
      c.req.raw.signal.addEventListener("abort", () => {
        away = true;
      });
      // Hiring can take a while; a ping every 10 s stops proxies closing a quiet stream.
      const ping = setInterval(() => write("{}", "ping"), 10_000);
      try {
        // No abort signal: once a turn starts it runs to the end even if the reader leaves,
        // because an agent may already have been paid. The app fetches the saved reply.
        const reply = await concierge({
          context: { user, chatId: chat.id },
          history,
          text,
          images,
          emit,
        });
        const saved = await store.add(chat.id, "assistant", reply.text, reply.cards);
        emit({ type: "done", messageId: saved.id });
        const nudge = away && Date.now() - started >= readyAfterMs;
        void (async () => {
          const shown = mirror
            ? await mirror(user.id, chat.id, text, reply).catch(() => false)
            : false;
          if (nudge && !shown) await replyReady?.(user.id, chat.id, chat.title, reply.text);
        })().catch(() => {});
      } catch (err) {
        console.error(`chat ${chat.id}: ${err instanceof Error ? err.message : err}`);
        await store.add(chat.id, "assistant", "Sorry, something went wrong. Please try again.");
        emit({ type: "error", message: "Something went wrong. Please try again." });
      } finally {
        clearInterval(ping);
      }
      await writes;
    });
    // no-transform: a proxy (Next's /api rewrite) must not gzip the stream, which holds every
    // event back until the end. Set after streamSSE, which sets its own Cache-Control.
    c.header("Cache-Control", "no-cache, no-transform");
    return res;
  });

  return app;
}
