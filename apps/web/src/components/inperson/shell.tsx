/** The in-person screens' frame (Get paid, Pay), and the shop's verified line. */
/** The shop's line under its name: a verified person (World ID), and its Hedera account. */
export function Verified({ m }: { m: { verified: boolean; account: string } }) {
  return (
    <span className={`text-xs font-semibold ${m.verified ? "text-ok" : "text-muted"}`}>
      {m.verified ? "✓ Verified person (World ID)" : "Not verified with World ID yet"} · {m.account}
    </span>
  );
}

export function Shell({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-6">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>
        {sub}
      </div>
      {children}
    </div>
  );
}
