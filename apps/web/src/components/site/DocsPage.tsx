import Link from "next/link";
import { TextPage } from "./TextPage";

export const DOCS = [
  { href: "/docs", label: "Overview" },
  { href: "/docs/build-an-agent", label: "Build an agent" },
  { href: "/docs/protocol", label: "Protocol reference" },
  { href: "/docs/payments", label: "Payments on Hedera" },
  { href: "/docs/arkiv", label: "Records on Arkiv" },
  { href: "/docs/claude", label: "Use it from Claude" },
] as const;

export type DocHref = (typeof DOCS)[number]["href"];

/** A page of the developer docs: the docs' contents beside it, and the next page at the end. */
export function DocsPage(p: {
  href: DocHref;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  const i = DOCS.findIndex((d) => d.href === p.href);
  const next = DOCS[i + 1];
  const nav = (
    <nav aria-label="Docs" className="sticky top-20 flex flex-col gap-0.5">
      <span className="px-3 pb-2 text-[11px] font-bold tracking-wider text-muted uppercase">
        Developer docs
      </span>
      {DOCS.map((d) => (
        <Link
          key={d.href}
          href={d.href}
          aria-current={d.href === p.href ? "page" : undefined}
          className={`flex min-h-9 items-center rounded-[10px] px-3 text-sm ${d.href === p.href ? "bg-teal-soft font-semibold text-teal" : "text-ink-2 hover:bg-side"}`}
        >
          {d.label}
        </Link>
      ))}
    </nav>
  );
  return (
    <TextPage title={p.title} lead={p.lead} aside={nav}>
      <nav
        aria-label="Docs pages"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:hidden"
      >
        {DOCS.map((d) => (
          <Link
            key={d.href}
            href={d.href}
            aria-current={d.href === p.href ? "page" : undefined}
            className={`flex min-h-9 flex-none items-center rounded-full border px-3 text-[13px] no-underline ${d.href === p.href ? "border-teal bg-teal-soft font-semibold text-teal" : "border-line text-ink-2"}`}
          >
            {d.label}
          </Link>
        ))}
      </nav>
      {p.children}
      {next && (
        <Link
          href={next.href}
          className="mt-6 flex flex-col gap-1 rounded-2xl border border-line p-5 no-underline hover:border-teal"
        >
          <span className="text-xs text-muted">Next</span>
          <span className="font-semibold text-teal">{next.label} →</span>
        </Link>
      )}
    </TextPage>
  );
}
