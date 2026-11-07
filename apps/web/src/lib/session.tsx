"use client";

import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { ApiError, api, type ChatSummary, type Me } from "./api";

interface Session {
  me: Me | null;
  chats: ChatSummary[];
  refreshChats: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Saves your name (Settings); the greeting and sidebar update at once. */
  setName: (name: string) => Promise<void>;
}

/** Your name to greet you by: not a device's label ("Android · Chrome", given at sign-up) or "Demo". */
export function realName(name: string | null | undefined): string | null {
  const n = name?.trim();
  if (!n || n === "Demo" || n.includes(" · ") || /^Shikigami \d{4}-\d{2}-\d{2}$/.test(n))
    return null;
  return n;
}

const SessionContext = createContext<Session | null>(null);

/**
 * Loads the signed-in user and their chats once for the whole app. A 401 means the cookie is
 * gone or expired, so we go to /login (the API is the real gatekeeper, not this).
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);

  const refreshChats = useCallback(async () => {
    setChats(await api<ChatSummary[]>("/chats"));
  }, []);

  useEffect(() => {
    let live = true;
    api<Me>("/me")
      .then((user) => {
        if (!live) return;
        setMe(user);
        return refreshChats();
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace("/login");
      });
    return () => {
      live = false;
    };
  }, [router, refreshChats]);

  const setName = useCallback(async (name: string) => {
    setMe(await api<Me>("/me", { method: "PATCH", body: { displayName: name } }));
  }, []);

  const signOut = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
  }, [router]);

  return (
    <SessionContext.Provider value={{ me, chats, refreshChats, signOut, setName }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession must be used inside SessionProvider");
  return s;
}
