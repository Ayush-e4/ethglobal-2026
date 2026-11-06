"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { createContext, type RefObject, useRef } from "react";

gsap.registerPlugin(useGSAP);

/** People who asked their phone for less motion get none of it. */
const still = () =>
  typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** False inside a chat turn that was already there when the chat opened: history stays still. */
export const FreshTurn = createContext(true);

/** Lists that already rose in this session (by name): coming back to a tab, they're just there. */
const played = new Set<string>();

/**
 * The elements marked `data-enter` inside `scope` rise in one after another when it first shows
 * (offers, suggestions, trips): the eye follows them in order, as in a native list. With `once`,
 * only the first time this session; with `enabled` false, never.
 */
export function useEnter(
  scope: RefObject<HTMLElement | null>,
  deps: unknown[] = [],
  { once, enabled = true }: { once?: string; enabled?: boolean } = {},
) {
  useGSAP(
    () => {
      if (!enabled || still() || (once && played.has(once))) return;
      if (!scope.current?.querySelector("[data-enter]")) return; // nothing to show yet
      if (once) played.add(once);
      gsap.from("[data-enter]", {
        y: 18,
        opacity: 0,
        scale: 0.985,
        duration: 0.38,
        ease: "power3.out",
        stagger: 0.05,
        clearProps: "transform,opacity",
      });
    },
    { scope, dependencies: deps },
  );
}

/**
 * New children of `list` rise in as they're added (a sent message, a reply), never the ones
 * already there when the list first painted (history loads still).
 */
export function useNewIn(list: RefObject<HTMLElement | null>, count: number) {
  const shown = useRef(count);
  useGSAP(
    () => {
      const before = shown.current;
      shown.current = count;
      // A whole conversation arriving at once is history loading: it appears still.
      if (count <= before || (before === 0 && count > 2) || still() || !list.current) return;
      const added = Array.from(list.current.children).slice(before);
      gsap.from(added, {
        y: 14,
        opacity: 0,
        duration: 0.32,
        ease: "power3.out",
        stagger: 0.08,
        clearProps: "transform,opacity",
      });
    },
    { dependencies: [count], scope: list },
  );
}
