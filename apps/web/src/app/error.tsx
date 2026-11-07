"use client";

import { CrashScreen } from "@/components/CrashScreen";

/** A public page broke (the home page, docs, a receipt). */
export default function SiteError({ error, retry }: { error: unknown; retry: () => void }) {
  return <CrashScreen error={error} retry={retry} home="/" />;
}
