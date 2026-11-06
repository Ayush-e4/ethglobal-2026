"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { haptic } from "@/lib/native/haptics";
import { ChatIcon, PlaneIcon, QrIcon, ScanIcon, WalletIcon } from "../icons";

/** The phone's tab bar: the app's five places, one thumb away, like a native app's. */
export const TABS = [
  { href: "/chat", label: "Chat", Icon: ChatIcon },
  { href: "/trips", label: "Trips", Icon: PlaneIcon },
  { href: "/pay", label: "Pay", Icon: ScanIcon },
  { href: "/get-paid", label: "Get paid", Icon: QrIcon },
  { href: "/wallet", label: "Wallet", Icon: WalletIcon },
] as const;

/** Screens that show the tab bar: the top of each place (a chat thread has its own composer). */
export function showsTabs(pathname: string) {
  return TABS.some((t) => t.href === pathname) || pathname === "/agents/list";
}

export function TabBar() {
  const pathname = usePathname();
  if (!showsTabs(pathname)) return null;
  const at = TABS.findIndex((t) => t.href === pathname);
  return (
    <nav
      aria-label="Main"
      className="tabbar fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/90 backdrop-blur-xl md:hidden"
    >
      <ul className="relative mx-auto flex max-w-[520px] items-stretch justify-around px-1">
        {/* The highlight slides from tab to tab, springing a little, like iOS and Android's. */}
        {at >= 0 && (
          <span
            aria-hidden
            className="tab-pill pointer-events-none absolute top-[7px] left-1 flex h-7 justify-center"
            style={{
              width: `calc((100% - 0.5rem) / ${TABS.length})`,
              transform: `translateX(${at * 100}%)`,
            }}
          >
            <span className="h-full w-12 rounded-full bg-teal-soft" />
          </span>
        )}
        {TABS.map(({ href, label, Icon }) => {
          const here = pathname === href;
          return (
            <li key={href} className="relative flex flex-1">
              <Link
                href={href}
                replace // tabs don't pile up in history (back never walks through every tab)
                transitionTypes={["tab"]}
                aria-current={here ? "page" : undefined}
                onClick={() => !here && haptic("tap")}
                className={`press flex min-h-[54px] flex-1 flex-col items-center justify-start gap-0.5 rounded-xl pt-[7px] text-[11px] font-semibold transition-colors duration-200 ${here ? "text-teal" : "text-muted"}`}
              >
                <span className="flex h-7 w-12 items-center justify-center">
                  <Icon size={21} strokeWidth={here ? 2.2 : 1.8} />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
