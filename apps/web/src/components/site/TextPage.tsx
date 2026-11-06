import { SiteShell } from "./SiteShell";

/** A page of text on the public site (docs, security, privacy, terms): readable width, styled prose. */
export function TextPage(p: {
  title: string;
  lead?: string;
  updated?: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <SiteShell>
      <div className="mx-auto flex max-w-[1100px] gap-10 px-4 py-10 sm:px-6 md:py-14">
        {p.aside && <aside className="hidden w-56 flex-none md:block">{p.aside}</aside>}
        <article className="prose-page flex min-w-0 max-w-[720px] flex-1 flex-col gap-4">
          <h1 className="text-[32px] leading-tight font-bold tracking-tight">{p.title}</h1>
          {p.lead && <p className="text-[17px] leading-relaxed text-ink-3">{p.lead}</p>}
          {p.updated && <p className="text-xs text-muted">Updated {p.updated}</p>}
          {p.children}
        </article>
      </div>
    </SiteShell>
  );
}
