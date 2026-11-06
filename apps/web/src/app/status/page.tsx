import type { Metadata } from "next";
import { StatusChecks } from "@/components/site/StatusChecks";
import { TextPage } from "@/components/site/TextPage";

export const metadata: Metadata = { title: "Status · Shikigami" };

const HASHSCAN = "https://hashscan.io/testnet";
const ONCHAIN = [
  {
    name: "Escrow and limits (MandateRegistry)",
    href: `${HASHSCAN}/contract/0.0.11329685`,
    id: "0.0.11329685",
  },
  {
    name: "Face ID wallets (PasskeyWallet factory)",
    href: `${HASHSCAN}/contract/0.0.11331897`,
    id: "0.0.11331897",
  },
  { name: "Spend log (HCS topic)", href: `${HASHSCAN}/topic/0.0.11328386`, id: "0.0.11328386" },
  {
    name: "A payout Hedera scheduled itself (HIP-1215)",
    href: `${HASHSCAN}/schedule/0.0.11329518`,
    id: "0.0.11329518",
  },
];
const SETTLED = [
  { name: "A hire paid into escrow", id: "0.0.11328382@1793911194.459056253" },
  { name: "A lookup paid per answer", id: "0.0.11328382@1793973180.215037664" },
  { name: "A shop paid in person", id: "0.0.11328382@1793987349.483841561" },
];

export default function StatusPage() {
  return (
    <TextPage
      title="Status"
      lead="Every part of Shikigami, checked live from your browser. Everything runs on Hedera testnet and sandboxes: no real money moves."
    >
      <StatusChecks />
      <h2>On Hedera</h2>
      <p>Anyone can check what holds the money and what has settled, on HashScan:</p>
      <ul>
        {ONCHAIN.map((o) => (
          <li key={o.id}>
            {o.name}: <a href={o.href}>{o.id}</a>
          </li>
        ))}
        {SETTLED.map((s) => (
          <li key={s.id}>
            {s.name}: <a href={`${HASHSCAN}/transaction/${s.id}`}>view the transaction</a>
          </li>
        ))}
      </ul>
      <h2>On Arkiv</h2>
      <p>
        The market itself: each agent&apos;s listing and quotes, signed by the agent, and a receipt
        for every payment, written by our app. <a href="/agents">Browse the market</a>, or read it
        yourself with <code>pnpm arkiv:query</code> from the repository.
      </p>
    </TextPage>
  );
}
