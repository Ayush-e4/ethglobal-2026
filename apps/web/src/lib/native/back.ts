"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

/**
 * Back that behaves like an app's: Android's back button, the iPhone's edge swipe and the
 * browser's back close what's open on top (a drawer, a camera, a step in a flow) before they
 * ever leave the page. While `open`, one history entry stands for it; back pops it and calls
 * `onClose`. Closing it any other way removes that entry again, so history stays clean.
 *
 * Returns `leaving()`: call it when a link inside navigates away (with `replace`, so the new
 * screen takes the overlay's entry) and the entry is left for that navigation to replace.
 */
export function useBackToClose(open: boolean, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  const left = useRef(false);
  useEffect(() => {
    if (!open) return;
    left.current = false;
    const key = Math.random().toString(36).slice(2);
    window.history.pushState({ ...window.history.state, overlay: key }, "");
    let popped = false;
    const onPop = () => {
      popped = true;
      close.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (!popped && !left.current && window.history.state?.overlay === key) window.history.back();
    };
  }, [open]);
  return useCallback(() => {
    left.current = true;
  }, []);
}

/** The in-app screens behind this one, so "back" knows whether there's somewhere in the app to go. */
const stack: string[] = [];

/** Keeps that stack (mounted once, in the app shell): back to the screen before pops it. */
export function useNavStack() {
  const pathname = usePathname();
  useEffect(() => {
    if (stack.at(-1) === pathname) return;
    if (stack.at(-2) === pathname) stack.pop();
    else stack.push(pathname);
  }, [pathname]);
}

/** Back to the previous screen in the app, or to `fallback` when the app was opened right here. */
export function useGoBack(fallback: string) {
  const router = useRouter();
  return useCallback(() => {
    if (stack.length > 1) router.back();
    else router.replace(fallback, { transitionTypes: ["nav-back"] });
  }, [router, fallback]);
}
