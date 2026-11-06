import { AgentPage } from "@/components/market/AgentPage";
import { PublicShell } from "@/components/market/PublicShell";

/** One agent's public page. */
export default async function AgentAddressPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  return (
    <PublicShell>
      <AgentPage address={address} />
    </PublicShell>
  );
}
