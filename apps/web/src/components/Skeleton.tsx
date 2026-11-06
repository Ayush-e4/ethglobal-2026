/** Grey shapes where content is about to be, shimmering: the page never looks frozen or empty. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`skeleton block rounded-xl ${className}`} />;
}

/** A card-shaped placeholder (a trip, a limit, a shop): a title line, two lines and a button. */
export function CardSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="flex flex-col gap-3 rounded-2xl border border-line p-4"
    >
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-5/6" />
      <Skeleton className="mt-1 h-10 w-32" />
    </div>
  );
}
