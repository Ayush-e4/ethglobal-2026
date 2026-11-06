import type { Metadata } from "next";
import { TextPage } from "@/components/site/TextPage";

export const metadata: Metadata = { title: "Security · Shikigami" };

export default function SecurityPage() {
  return (
    <TextPage
      title="Security"
      lead="Money only moves where Hedera says it may, and we tried to break the rest before you could. Here is what protects you, what we fixed, and what we know isn't done."
      updated="7 Nov 2026"
    >
      <h2>What protects your money</h2>
      <ul>
        <li>
          <b>Limits enforced on Hedera, not by us.</b> The AI can only spend through a limit you
          approve with Face ID: one agent, one chat, a budget and a cap per payment. The contract
          refuses anything else, whoever asks.
        </li>
        <li>
          <b>Escrow with an undo window.</b> A hire's money goes into escrow, not to the agent. You
          can undo for a minute; the agent is paid only after it delivers and a review window
          passes; a reported problem freezes it; an undelivered job is refunded.
        </li>
        <li>
          <b>The AI signs only what was agreed.</b> Its key signs the quoted amount, to the quoted
          agent, into escrow, with a review window. A payment request asking for more or other is
          refused before anything is signed.
        </li>
        <li>
          <b>A real person for anything big.</b> Larger payments (fee plus trip price), ratings and
          becoming a shop need World ID.
        </li>
        <li>
          <b>Your keys are your device&apos;s.</b> Your wallet is a passkey (Face ID): the key never
          leaves your phone, and there&apos;s no seed phrase to steal.
        </li>
      </ul>

      <h2>Reviewed before launch</h2>
      <p>
        Before submission, four reviewers attacked the code read-only. Each finding we fixed has a
        test:
      </p>
      <ul>
        <li>The app acts only on the escrow it paid, never on an id an agent sends back.</li>
        <li>The shared demo wallet can&apos;t be drained: its caps count everything it pays.</li>
        <li>
          Shops are one real person each; a QR pays only when it&apos;s live on the shop&apos;s
          screen.
        </li>
        <li>Free reports can&apos;t suspend agents; redirects after sign-in stay on this site.</li>
        <li>
          Demo accounts can&apos;t send email through us; the connect page warns that an app&apos;s
          name isn&apos;t verified.
        </li>
      </ul>
      <p>
        What held up: no secrets in the code or its history; no way to reach another person&apos;s
        data; sessions stored hashed in secure cookies; single-use passkey challenges; OAuth with
        PKCE; contracts that bind every signature to its limit, payee and nonce.
      </p>

      <h2>Known limits</h2>
      <ul>
        <li>Our agents don&apos;t yet re-check an escrow&apos;s terms when they book.</li>
        <li>
          Agents report their own deliveries; reports and ratings from verified people balance that.
        </li>
        <li>
          Hiring relies on the AI following &ldquo;only what you chose&rdquo;, backed by your limit,
          World ID for larger payments, the undo window, and no hiring after reading a web page.
        </li>
        <li>A chirp can be relayed over a phone call: check the shop&apos;s name before paying.</li>
        <li>Sign-ups, chats and quotes aren&apos;t rate-limited yet (demo sign-ups are).</li>
      </ul>

      <h2>Report a problem</h2>
      <p>
        Found something? Open a private security advisory on the project&apos;s GitHub repository,
        or an issue for anything that isn&apos;t sensitive. This runs on testnets only: no real
        money is at risk.
      </p>
    </TextPage>
  );
}
