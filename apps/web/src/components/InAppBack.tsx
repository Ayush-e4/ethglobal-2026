"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cameFromApp } from "@/lib/native/back";
import { BackIcon } from "./icons";

/**
 * On a public page (the market, a receipt) reached from inside the app: a Back to where you were,
 * as an app would have. Someone who opened a shared link sees nothing here.
 */
export function InAppBack() {
  const router = useRouter();
  const [show, setShow] = useState(false);
  useEffect(() => setShow(cameFromApp()), []);
  if (!show) return null;
  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="press flex h-11 items-center gap-0.5 rounded-xl pr-2 pl-1 text-[15px] font-semibold text-teal"
    >
      <BackIcon size={22} /> Back
    </button>
  );
}
