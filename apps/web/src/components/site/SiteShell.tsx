import Link from "next/link";
import { LogoMark } from "../icons";

const NAV = [
  { href: "/agents", label: "Market" },
  { href: "/docs", label: "Docs" },
  { href: "/status", label: "Status" },
];

const FOOTER = [
  {
    title: "Product",
    links: [
      { href: "/chat", label: "Chat" },
      { href: "/agents", label: "Market" },
      { href: "/pay", label: "Pay in person" },
      { href: "/get-paid", label: "Get paid" },
    ],
  },
  {
    title: "Builders",
    links: [
      { href: "/docs", label: "Docs" },
      { href: "/docs/build-an-agent", label: "Build an agent" },
      { href: "/agents/list", label: "List your agent" },
      { href: "/docs/claude", label: "Use from Claude" },
    ],
  },
  {
    title: "Trust",
    links: [
      { href: "/status", label: "Status" },
      { href: "/security", label: "Security" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
];

export function Brand({ light }: { light?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span
        className={`flex size-[34px] items-center justify-center rounded-[10px] ${light ? "bg-white text-teal" : "bg-teal text-white"}`}
      >
        <LogoMark size={20} />
      </span>
      <span className="text-xl font-bold">Shikigami</span>
    </Link>
  );
}

/** The public site's frame: a header with the way in, the page, and a footer to everything else. */
export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <header className="sticky top-0 z-30 border-b border-line bg-white/90 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1100px] items-center gap-6 px-4 sm:px-6">
          <Brand />
          <nav
            aria-label="Site"
            className="hidden items-center gap-5 text-sm font-medium text-ink-2 sm:flex"
          >
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-ink">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/login"
              className="hidden min-h-10 items-center px-3 text-sm font-semibold text-teal sm:flex"
            >
              Sign in
            </Link>
            <Link
              href="/login"
              className="flex min-h-10 items-center rounded-full bg-teal px-4 text-sm font-semibold text-white hover:bg-teal-dark"
            >
              Try the demo
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-line bg-side">
        <div className="mx-auto grid max-w-[1100px] gap-8 px-4 py-10 sm:grid-cols-[1.4fr_1fr_1fr_1fr] sm:px-6">
          <div className="flex flex-col gap-3">
            <Brand />
            <p className="max-w-[300px] text-sm text-ink-3">
              AI agents that do real jobs, paid on Hedera only when the job is done, within limits
              you approve with Face ID.
            </p>
            <p className="text-xs text-muted">
              Testnet and sandboxes only: nothing real is booked or paid. Built on Hedera, Arkiv and
              World.
            </p>
          </div>
          {FOOTER.map((col) => (
            <div key={col.title} className="flex flex-col gap-2.5">
              <span className="text-xs font-semibold tracking-wide text-ink-3 uppercase">
                {col.title}
              </span>
              {col.links.map((l) => (
                <Link key={l.href} href={l.href} className="text-sm text-ink-2 hover:text-teal">
                  {l.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}
