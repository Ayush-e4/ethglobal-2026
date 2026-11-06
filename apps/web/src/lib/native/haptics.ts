/**
 * Haptics, as close to an app's as the web allows. Android: the Vibration API. iPhones have no
 * Vibration API, but iOS 18+ gives a light tick when a `switch` checkbox is toggled by a tap, so a
 * tap can borrow it (an async moment, like a payment landing, gets no tick on iPhones). Silent
 * when the person asked for reduced motion, and never throws.
 */
export type Haptic = "tap" | "success" | "warning" | "error";

const PATTERNS: Record<Haptic, number | number[]> = {
  tap: 8,
  success: [14, 60, 22],
  warning: [24, 50, 24],
  error: [40, 40, 40, 40, 40],
};

let iosSwitch: HTMLLabelElement | null = null;

function iosTick() {
  if (!iosSwitch) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    input.setAttribute("aria-hidden", "true");
    label.append(input);
    label.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;";
    label.setAttribute("aria-hidden", "true");
    document.body.append(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}

export function haptic(kind: Haptic = "tap") {
  try {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ua = navigator.userAgent;
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(PATTERNS[kind]);
      return;
    }
    if (kind === "tap" && /iPhone|iPad|iPod/.test(ua)) iosTick();
  } catch {}
}
