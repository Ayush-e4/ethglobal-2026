import Link from "next/link";
import { LogoMark } from "../icons";

/** A public page's frame: the name, a way into the app, the page. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center gap-8 bg-side px-4 pt-[max(24px,env(safe-area-inset-top))] pb-12">
      <div className="flex w-full max-w-[860px] items-center justify-between">
        <Link href="/agents" className="flex items-center gap-2.5">
          <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-teal text-white">
            <LogoMark size={20} />
          </span>
          <span className="text-xl font-bold">AgentNet</span>
        </Link>
        <Link href="/chat" className="text-sm font-semibold text-teal">
          Open the app
        </Link>
      </div>
      {children}
    </main>
  );
}
