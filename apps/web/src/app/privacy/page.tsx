import type { Metadata } from "next";
import { TextPage } from "@/components/site/TextPage";

export const metadata: Metadata = { title: "Privacy · Shikigami" };

export default function PrivacyPage() {
  return (
    <TextPage
      title="Privacy"
      lead="What we keep, what's public by design, and what we never see."
      updated="7 Nov 2026"
    >
      <h2>What we keep</h2>
      <ul>
        <li>
          <b>Your account:</b> your passkeys&apos; public keys, a display name, and your email if
          you add one.
        </li>
        <li>
          <b>Your chats,</b> so you can come back to them. To answer, they&apos;re sent to Claude
          (Anthropic); photos you send are kept as small thumbnails.
        </li>
        <li>
          <b>Saved travellers</b> (name, email, phone, and for flights a birth date and gender).
          They&apos;re sent only to the agent you hire for that booking, and only the details it
          needs. Never to the AI model, never on Arkiv.
        </li>
        <li>
          <b>Your bookings and payments</b> in our database, to show them to you.
        </li>
        <li>
          <b>World ID:</b> only what proves one person (a nullifier, a pseudonymous key), never who
          you are.
        </li>
      </ul>

      <h2>Public by design</h2>
      <ul>
        <li>
          <b>Payments on Hedera</b> are public, as on any blockchain: amounts and accounts, not
          names.
        </li>
        <li>
          <b>The market on Arkiv</b> is public: agents&apos; listings and quotes, a receipt for each
          payment (pointing at its Hedera transaction), problems reported against agents, and
          ratings by verified people under a pseudonym that doesn&apos;t link across agents.
        </li>
      </ul>

      <h2>What we never have</h2>
      <ul>
        <li>Your Face ID or fingerprint: your device checks it; we only see a signature.</li>
        <li>A password or a seed phrase: there isn&apos;t one.</li>
        <li>Your identity from World ID.</li>
      </ul>

      <h2>Your choices</h2>
      <ul>
        <li>
          Delete saved travellers, disconnect apps like Claude, stop Telegram alerts, and remove
          devices in Settings.
        </li>
        <li>Demo accounts are throwaway: they hold no personal data and get no email.</li>
        <li>To delete your account, open an issue on the project&apos;s GitHub repository.</li>
      </ul>
      <p>
        This is a testnet product built for ETHGlobal Mumbai: please don&apos;t enter real personal
        details for anyone but yourself.
      </p>
    </TextPage>
  );
}
