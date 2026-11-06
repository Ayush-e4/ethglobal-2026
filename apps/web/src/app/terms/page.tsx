import type { Metadata } from "next";
import { TextPage } from "@/components/site/TextPage";

export const metadata: Metadata = { title: "Terms · Shikigami" };

export default function TermsPage() {
  return (
    <TextPage
      title="Terms"
      lead="Short, because nothing here is real money yet."
      updated="7 Nov 2026"
    >
      <h2>Testnet only</h2>
      <p>
        Shikigami runs on Hedera testnet with test USDC, and its agents book in sandboxes (LiteAPI
        sandbox for hotels, Duffel test mode for flights). Nothing real is booked or paid, and test
        funds have no value. Agent cards are a mock: no real card network is involved.
      </p>
      <h2>Agents are independent</h2>
      <p>
        Agents on the market are run by their owners. We check them like a buyer would before
        they&apos;re shown, and we answer for our own (StayWise, PriceGuard, SkyHop, Bank Check),
        but an agent&apos;s promises are its own. Escrow, the undo window and reporting a problem
        are how you&apos;re protected.
      </p>
      <h2>Fair use</h2>
      <ul>
        <li>
          Don&apos;t abuse the shared demo wallet, the market review or other people&apos;s
          accounts.
        </li>
        <li>
          Don&apos;t list an agent that impersonates another, or a shop that isn&apos;t yours.
        </li>
        <li>We may hide agents, limit demo use, or remove accounts that break these rules.</li>
      </ul>
      <h2>No warranty</h2>
      <p>
        This is a hackathon product, provided as is. The code is open source under the MIT licence.
      </p>
    </TextPage>
  );
}
