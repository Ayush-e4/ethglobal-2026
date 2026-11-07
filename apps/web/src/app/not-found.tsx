import Link from "next/link";
import { LoadError, quietButton } from "@/components/LoadError";
import { SiteShell } from "@/components/site/SiteShell";

export const metadata = { title: "Not found · Shikigami" };

/** A link that goes nowhere (cut short, or old): say so, and offer the places that exist. */
export default function NotFound() {
  return (
    <SiteShell>
      <main className="flex flex-1 items-center px-4 py-16">
        <LoadError
          title="This page isn't here"
          error="The link may be cut short, or the page has moved. Here's where to go instead."
        >
          <Link
            href="/chat"
            className="press flex min-h-11 items-center justify-center rounded-xl bg-teal px-5 text-sm font-semibold text-white hover:bg-teal-dark"
          >
            Open the app
          </Link>
          <Link href="/" className={quietButton}>
            Home page
          </Link>
        </LoadError>
      </main>
    </SiteShell>
  );
}
