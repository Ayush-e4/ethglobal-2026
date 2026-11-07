"use client";

import { CrashScreen } from "@/components/CrashScreen";

/** A screen in the app broke: the menu and tabs stay, and this takes its place. */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return <CrashScreen error={error} retry={retry} />;
}
