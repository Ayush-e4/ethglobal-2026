import type { Card } from "@app/shared";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { type Chat, chats, messages } from "../db/schema";

/** Chats belong to one user: every read and write here is scoped by user id. */
export function chatStore(db: Db) {
  return {
    async create(userId: string, title: string): Promise<Chat> {
      const [chat] = await db
        .insert(chats)
        .values({ userId, title: title.slice(0, 80) || "New chat" })
        .returning();
      if (!chat) throw new Error("could not create the chat");
      return chat;
    },
    list: (userId: string) =>
      db
        .select()
        .from(chats)
        .where(eq(chats.userId, userId))
        .orderBy(desc(chats.updatedAt))
        .limit(50),
    async get(userId: string, chatId: string): Promise<Chat | null> {
      const [chat] = await db
        .select()
        .from(chats)
        .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
        .limit(1);
      return chat ?? null;
    },
    messages: (chatId: string) =>
      db
        .select()
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(asc(messages.createdAt)),
    async add(chatId: string, role: "user" | "assistant", text: string, cards: Card[] = []) {
      const [m] = await db.insert(messages).values({ chatId, role, text, cards }).returning();
      await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, chatId));
      if (!m) throw new Error("could not save the message");
      return m;
    },
  };
}

export type ChatStore = ReturnType<typeof chatStore>;
