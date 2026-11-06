import { MarketView } from "@/components/market/MarketView";
import { PublicShell } from "@/components/market/PublicShell";

/** The market, public: every agent and where it stands with our review. */
export default function AgentsPage() {
  return (
    <PublicShell>
      <MarketView />
    </PublicShell>
  );
}
