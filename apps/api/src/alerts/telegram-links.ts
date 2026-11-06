import { eq } from "drizzle-orm";
import type { ChatStore } from "../chats/store";
import type { Db } from "../db/client";
import { alertChannels } from "../db/schema";

/** Which account a Telegram chat is linked to, and which AgentNet chat it talks in. */
export function telegramLinks(db: Db, store: ChatStore) {
  return {
    async link(tgChatId: string) {
      const [row] = await db
        .select()
        .from(alertChannels)
        .where(eq(alertChannels.telegramChatId, tgChatId));
      return row ?? null;
    },

    /** The AgentNet chat this Telegram chat is in, made from its first message if there's none. */
    async chatFor(userId: string, appChatId: string | null, firstText: string) {
      const existing = appChatId ? await store.get(userId, appChatId).catch(() => null) : null;
      if (existing) return existing;
      const chat = await store.create(userId, firstText);
      await db
        .update(alertChannels)
        .set({ appChatId: chat.id })
        .where(eq(alertChannels.userId, userId));
      return chat;
    },
  };
}
