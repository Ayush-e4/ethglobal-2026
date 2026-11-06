import type { AgentReviewView } from "@/lib/api";

/** Where an agent stands with the marketplace's review, in a word or two. */
export function ReviewBadge({ review }: { review: AgentReviewView | null }) {
  const [label, tone] = !review
    ? ["Not reviewed", "bg-side text-ink-3"]
    : review.status === "approved"
      ? ["✓ Checked by Shikigami", "bg-ok-soft text-ok"]
      : review.status === "suspended"
        ? ["Hidden: failed its checks", "bg-bad-soft text-bad"]
        : ["Didn't pass its checks", "bg-bad-soft text-bad"];
  return (
    <span className={`flex-none rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>
      {label}
    </span>
  );
}

export const operatorLine = (r: AgentReviewView | null) =>
  r?.operator === "agentnet"
    ? "Run by Shikigami"
    : r?.operator === "verified-person"
      ? "Run by a person verified with World ID"
      : "Owner not verified";
