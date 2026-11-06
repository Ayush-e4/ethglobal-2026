"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, Suspense, useEffect, useState, ViewTransition } from "react";
import { useBackToClose, useGoBack, useNavStack } from "@/lib/native/back";
import { BackIcon, LogoMark, MenuIcon, PlusIcon } from "../icons";
import { OfflineBar } from "./OfflineBar";
import { Sidebar } from "./Sidebar";
import { showsTabs, TabBar } from "./TabBar";

const PAGE_MOTION = {
  tab: "tab",
  "nav-forward": "nav-forward",
  "nav-back": "nav-back",
  default: "none",
};

/**
 * Everything behind sign-in. Desktop: the sidebar stays put while the page scrolls. Phones: a
 * slim top bar (a back button on screens below a tab), the tab bar at the bottom like an app's,
 * and the sidebar as a drawer that back closes. Pages slide in with the View Transitions API.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useNavStack(showsTabs);
  const leaving = useBackToClose(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", close);
    document.body.style.overflow = "hidden"; // the page behind the drawer stays still
    return () => {
      document.removeEventListener("keydown", close);
      document.body.style.overflow = "";
    };
  }, [open]);

  const tabs = showsTabs(pathname);
  const back = useGoBack("/chat");

  return (
    <div className="min-h-dvh md:flex">
      <header className="appbar sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-white/90 px-2 backdrop-blur-xl md:hidden">
        {tabs ? (
          <button
            type="button"
            aria-label="Open the menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className="press flex size-11 items-center justify-center rounded-xl text-ink-2"
          >
            <MenuIcon size={22} />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Back"
            onClick={back}
            className="press flex h-11 items-center gap-0.5 rounded-xl pr-2 pl-1 text-[15px] font-semibold text-teal"
          >
            <BackIcon size={22} /> Back
          </button>
        )}
        <Link href="/chat" className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-teal text-white">
            <LogoMark size={16} />
          </span>
          <span className="text-base font-bold">Shikigami</span>
        </Link>
        <Link
          href="/chat"
          aria-label="New chat"
          className="press ml-auto flex size-11 items-center justify-center rounded-xl text-teal"
        >
          <PlusIcon size={22} />
        </Link>
      </header>
      {open && (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fade-in fixed inset-0 z-40 bg-[#182026]/35 md:hidden"
        />
      )}
      {/* The sidebar reads the URL, which only exists at request time. */}
      <Suspense
        fallback={
          <aside className="hidden h-dvh w-[272px] flex-none border-r border-line bg-side md:block" />
        }
      >
        <Sidebar
          open={open}
          onClose={() => setOpen(false)}
          onNavigate={() => {
            leaving();
            setOpen(false);
          }}
        />
      </Suspense>
      {/* Only navigations tagged with a direction animate (browser back and refreshes don't). */}
      <ViewTransition update={PAGE_MOTION} default="none">
        <div className={`flex min-w-0 flex-1 flex-col ${tabs ? "with-tabbar" : ""}`}>
          <OfflineBar />
          {children}
        </div>
      </ViewTransition>
      <TabBar />
    </div>
  );
}
