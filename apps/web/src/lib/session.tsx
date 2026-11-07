"use client";

import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { ApiError, api, type ChatSummary, type Me } from "./api";
import { SIGNED_OUT_EVENT } from "./errors";

interface Session {
  me: Me | null;
  chats: ChatSummary[];
  refreshChats: () => Promise<void>;
  signOut: () => Promise<void>;
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

  // Signed out (now, or mid-use when the cookie expires): sign in, then straight back here.
  useEffect(() => {
    const toLogin = () => {
      const here = `${location.pathname}${location.search}`;
      router.replace(here === "/chat" ? "/login" : `/login?next=${encodeURIComponent(here)}`);
    };
    window.addEventListener(SIGNED_OUT_EVENT, toLogin);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, toLogin);
  }, [router]);

  useEffect(() => {
    let live = true;
    let again: ReturnType<typeof setTimeout> | undefined;
    // No answer (offline, a restart): try again in a few seconds, or once it's back online.
    const load = () => {
      clearTimeout(again);
      api<Me>("/me")
        .then((user) => {
          if (!live) return;
          setMe(user);
          return refreshChats();
        })
        .catch((err) => {
          if (!live || (err instanceof ApiError && err.status === 401)) return; // signed out
          again = setTimeout(load, 5000);
        });
    };
    load();
    window.addEventListener("online", load);
    return () => {
      live = false;
      clearTimeout(again);
      window.removeEventListener("online", load);
    };
  }, [refreshChats]);

  const signOut = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
  }, [router]);

  return (
    <SessionContext.Provider value={{ me, chats, refreshChats, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession must be used inside SessionProvider");
  return s;
}
