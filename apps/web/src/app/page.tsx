import { APP } from "@app/shared";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-4">
      <h1 className="text-2xl font-semibold text-ink">{APP.name}</h1>
      <p className="text-muted">{APP.tagline}</p>
    </main>
  );
}
