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
  return (
    <nav
      aria-label="Main"
      className="tabbar fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/90 backdrop-blur-xl md:hidden"
    >
      <ul className="mx-auto flex max-w-[520px] items-stretch justify-around px-1">
        {TABS.map(({ href, label, Icon }) => {
          const here = pathname === href;
          return (
            <li key={href} className="flex flex-1">
              <Link
                href={href}
                transitionTypes={["tab"]}
                aria-current={here ? "page" : undefined}
                onClick={() => !here && haptic("tap")}
                className={`press flex min-h-[54px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold ${here ? "text-teal" : "text-muted"}`}
              >
                <span
                  className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-200 ${here ? "bg-teal-soft" : ""}`}
                >
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
