"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Grant {
  id: string;
  app: string;
  chatId: string | null;
  connectedAt: string;
  lastUsedAt: string | null;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * Apps connected to this account (Claude, over MCP): what they've done shows in their chat, and
 * Disconnect stops them at once. How to connect one, when none is.
 */
export function ConnectedApps() {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const load = useCallback(
    () =>
      api<Grant[]>("/oauth/grants")
        .then(setGrants)
        .catch(() => setGrants([])),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!grants) return null;
  const mcpUrl = typeof window === "undefined" ? "/mcp" : `${window.location.origin}/mcp`;

  return (
    <section
      aria-label="Connected apps"
      className="flex flex-col gap-3 rounded-2xl border border-line p-4 text-sm"
    >
      <div className="flex flex-col gap-1">
        <span className="font-semibold">Connected apps</span>
        <span className="text-ink-3">
          Use Shikigami from Claude: add a custom connector with{" "}
          <span className="font-mono text-ink-2">{mcpUrl}</span> and sign in here when it asks. It
          hires only within the limits you approve.
        </span>
      </div>
      {grants.map((g) => (
        <div
          key={g.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2"
        >
          <span className="flex flex-col">
            <span className="font-semibold">{g.app}</span>
            <span className="text-xs text-muted">
              Connected {when(g.connectedAt)}
              {g.lastUsedAt ? ` · last used ${when(g.lastUsedAt)}` : ""}
            </span>
          </span>
          <span className="flex gap-2">
            {g.chatId && (
              <Link
                href={`/chat/${g.chatId}`}
                className="flex h-9 max-md:h-11 items-center rounded-[10px] border border-line-2 bg-white px-3 text-[13px] font-semibold"
              >
                Its chat
              </Link>
            )}
            <button
              type="button"
              onClick={() => void api(`/oauth/grants/${g.id}`, { method: "DELETE" }).then(load)}
              className="h-9 max-md:h-11 rounded-[10px] border border-line-2 bg-white px-3 text-[13px] font-semibold text-bad"
            >
              Disconnect
            </button>
          </span>
        </div>
      ))}
    </section>
  );
}
