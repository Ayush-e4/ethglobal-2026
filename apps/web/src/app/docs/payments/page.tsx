import type { Metadata } from "next";
import { DocsPage } from "@/components/site/DocsPage";

export const metadata: Metadata = { title: "Payments on Hedera · Shikigami docs" };

const HASHSCAN = "https://hashscan.io/testnet";

const FLOW = `buyer's AI ──POST /book──────────────────▶ agent (x402 paywall)
           ◀── 402: fee + price, pay the escrow, undo 60 s, review 15 min
signs a payment its spending limit allows (EIP-712)
           ──POST /book + PAYMENT-SIGNATURE ─▶ agent ──/settle──▶ facilitator
                                                                 │ simulate the exact call
                                                                 │ submit it (pays the gas)
                                                                 │ check the ledger moved exactly that
                                                                 ▼
                                               MandateRegistry.executeTransfer(…) → Held
           ◀── 202 accepted + PAYMENT-RESPONSE (the Hedera transaction)`;

export default function Payments() {
  return (
    <DocsPage
      href="/docs/payments"
      title="Payments on Hedera"
      lead="Every payment goes through one contract, MandateRegistry: a spending limit the buyer approved, escrow with an undo window, and a payout Hedera runs by itself."
    >
      <p>
        Web2 terms: a company card with spend rules, plus &ldquo;Undo send&rdquo;, plus an escrow
        service, all run by public code nobody (us included) can change. The contract has no admin
        and can&apos;t be upgraded. Payments are in Circle&apos;s test USDC (<code>0.0.429274</code>
        , 6 decimals).
      </p>

      <h2>Spending limits</h2>
      <p>
        A buyer gives their AI a limit with Face ID: a budget, a cap per payment, an expiry and the
        only agents it may pay. Every payment must pass, in the contract:
      </p>
      <ol>
        <li>
          The limit (and any parent limit) exists, isn&apos;t revoked and hasn&apos;t expired.
        </li>
        <li>The signed payment hasn&apos;t expired and its nonce is unused: each works once.</li>
        <li>It&apos;s signed by the limit&apos;s AI key (or a passkey smart wallet, ERC-1271).</li>
        <li>The amount is within the cap and what&apos;s left of the budget.</li>
        <li>The payee is allowed.</li>
      </ol>

      <h2>Pay on delivery</h2>
      <table>
        <thead>
          <tr>
            <th>Step</th>
            <th>Who</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              Paid into escrow: <b>held</b>
            </td>
            <td>anyone, with the AI&apos;s signature</td>
            <td>at hire</td>
          </tr>
          <tr>
            <td>
              <code>cancel</code>: full refund
            </td>
            <td>buyer or their AI</td>
            <td>during the undo window</td>
          </tr>
          <tr>
            <td>
              <code>markDelivered</code>
            </td>
            <td>the agent</td>
            <td>after the window, by the deadline</td>
          </tr>
          <tr>
            <td>
              <code>dispute</code>: frozen
            </td>
            <td>buyer or their AI</td>
            <td>during the review window</td>
          </tr>
          <tr>
            <td>
              <code>claim</code>: the agent is paid
            </td>
            <td>anyone, including Hedera itself</td>
            <td>after the review, if not disputed</td>
          </tr>
          <tr>
            <td>
              <code>refund</code>
            </td>
            <td>the agent</td>
            <td>any time it&apos;s open</td>
          </tr>
          <tr>
            <td>
              <code>reclaim</code>: back to the buyer
            </td>
            <td>anyone</td>
            <td>not delivered by the deadline</td>
          </tr>
        </tbody>
      </table>
      <p>
        The undo and review windows are part of what the AI signs, so nobody can shorten them
        afterwards.
      </p>

      <h2>Hedera pays the agent by itself</h2>
      <p>
        When an agent marks a job delivered, the contract asks Hedera&apos;s schedule service
        (HIP-1215) to call its own <code>claim</code> when the review ends. The network runs it on
        time, so the agent is paid even if every server of ours is down. A disputed job&apos;s
        scheduled claim is simply refused. Web2 terms: a cron job inside the database, run by the
        database.
      </p>

      <h2>x402</h2>
      <p>
        Agents ask to be paid inside the request: <code>402 Payment Required</code> with a price,
        the client pays and sends the request again. We use the official x402 packages with the
        spec&apos;s <code>transferExecutor</code> method, so the money moves through the contract
        and every rule above holds on every payment.
      </p>
      <pre>
        <code>{FLOW}</code>
      </pre>
      <ul>
        <li>
          <b>Paid now</b>: <code>payTo</code> is the agent (a lookup&apos;s fee).
        </li>
        <li>
          <b>Held</b>: <code>payTo</code> is the contract, with <code>extra.escrow</code> naming the
          payee and the windows (a booking).
        </li>
      </ul>
      <p>
        The facilitator (<code>packages/x402</code>) only submits calls to admitted contracts, never
        takes calldata from the client, and checks the ledger afterwards: the payee gained exactly
        the amount, the payer lost exactly that, and nothing else moved. A payment already in flight
        can&apos;t be submitted twice. The buyer&apos;s side refuses a 402 that asks for more than
        the quote, another payee, or shorter windows, before signing anything.
      </p>

      <h2>On HashScan</h2>
      <ul>
        <li>
          MandateRegistry: <a href={`${HASHSCAN}/contract/0.0.11329685`}>0.0.11329685</a> (
          <code>0x3287ee420479437d57fcace38368c3df98e32737</code>)
        </li>
        <li>
          Passkey wallet factory: <a href={`${HASHSCAN}/contract/0.0.11331897`}>0.0.11331897</a>
        </li>
        <li>
          Public log of settled payments (HCS):{" "}
          <a href={`${HASHSCAN}/topic/0.0.11328386`}>0.0.11328386</a>
        </li>
        <li>
          A hire held in escrow:{" "}
          <a href={`${HASHSCAN}/transaction/0.0.11328382@1793911194.459056253`}>transaction</a>; its
          payout, scheduled by the contract and run by Hedera:{" "}
          <a href={`${HASHSCAN}/schedule/0.0.11329518`}>schedule 0.0.11329518</a>
        </li>
      </ul>
    </DocsPage>
  );
}
