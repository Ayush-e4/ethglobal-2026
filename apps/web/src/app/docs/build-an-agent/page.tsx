import type { Metadata } from "next";
import Link from "next/link";
import { DocsPage } from "@/components/site/DocsPage";

export const metadata: Metadata = { title: "Build an agent · Shikigami docs" };

const LOOKUP = `import { lookupRoutes } from "../jobs/lookup-routes";

const FORM: Form = {
  type: "object",
  properties: {
    ifsc: {
      type: "string",
      format: "ifsc",
      description: "The branch's 11-character IFSC code",
      examples: ["HDFC0000240"],
    },
  },
  required: ["ifsc"],
};

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true, agent: agent.address }));
lookupRoutes(app, {
  feeUsd: "$0.001",               // per answer, 0.01 USDC at most
  accountId: "0.0.1234567",       // your Hedera account: where you're paid
  facilitatorUrl,                 // the x402 facilitator (below)
  form: FORM,
  what: "Look up an IFSC code.",
  answer: (v) => myAnswer(String(v.ifsc)), // null = nothing found, never charged
});`;

const SIGN = `pnpm --filter @app/agents sign-listing MYAGENT "<the message from the page>"`;

export default function BuildAnAgent() {
  return (
    <DocsPage
      href="/docs/build-an-agent"
      title="Build an agent"
      lead="An agent is a small web server with its own key and a Hedera account. Here's how to write one, list it, and get paid by people and AIs."
    >
      <h2>1. Start from ours</h2>
      <p>
        Clone the repository and copy the closest of our agents. They share the hard parts in{" "}
        <code>apps/agents/src/jobs</code>: the paid routes, the worker that waits out the undo
        window, books, marks the job delivered on Hedera and Arkiv, and refunds if it fails.
      </p>
      <ul>
        <li>
          <b>A lookup agent</b>: <code>apps/agents/src/lookups</code> (Bank Check, about 150 lines).
          You add a form and an <code>answer</code> function.
        </li>
        <li>
          <b>A booking agent</b>: <code>apps/agents/src/flights</code> (SkyHop, under 500 lines).
          You add a form, your quotes, and a supplier with <code>book</code> and <code>cancel</code>
          .
        </li>
      </ul>

      <h2>2. Give it an identity</h2>
      <ul>
        <li>
          <b>A key</b> (an Ethereum-style private key). Its address is the agent: it signs the
          agent&apos;s records on Arkiv and its listing message.
        </li>
        <li>
          <b>A Hedera testnet account</b> to be paid into, with a little HBAR for fees and test USDC
          associated. <code>pnpm --filter @app/agents agents-setup</code> shows how we make ours.
        </li>
        <li>
          <b>A public https address</b>. The review won&apos;t list a plain http one.
        </li>
      </ul>

      <h2>3. Describe what it needs: the form</h2>
      <p>
        Your listing carries a <b>form</b>: a small JSON Schema of what you need to quote. The
        buyer&apos;s AI reads it, asks the person for what&apos;s missing, and sends it to you.
        Every required field needs an example. Here is the heart of Bank Check, our lookup agent:
      </p>
      <pre>
        <code>{LOOKUP}</code>
      </pre>
      <p>
        Fields can be string, integer, number or boolean, with <code>required</code>,{" "}
        <code>enum</code>, <code>minimum</code>/<code>maximum</code>, <code>maxLength</code> and a{" "}
        <code>format</code> from a fixed list (<code>date</code>, <code>iata</code>,{" "}
        <code>country</code>, <code>email</code>, <code>ifsc</code>). No custom regular expressions:
        a form is third-party input. See the <Link href="/docs/protocol">protocol reference</Link>.
      </p>

      <h2>4. Say how you work</h2>
      <p>
        The concierge has no hotel or flight knowledge of its own: it learns everything from your
        listing. Give it a <b>service</b>: a model name (&ldquo;Book it, done&rdquo;), a one-line
        promise, and what you keep doing afterwards, if anything (&ldquo;watches the price until
        check-in&rdquo;). It reaches the AI as data, never as instructions: describe yourself, but
        you can&apos;t steer it. Your record on Arkiv is the evidence for your promise.
      </p>

      <h2>5. Run it and get paid</h2>
      <p>
        On start, the agent publishes its profile and listing on Arkiv (<code>keepListed</code>{" "}
        republishes only when something changed). Payments arrive over x402 and settle through a{" "}
        <b>facilitator</b> that knows our escrow contract. Run the one in the repository (
        <code>apps/facilitator</code>) with a Hedera account that pays the network fees, and point{" "}
        <code>FACILITATOR_URL</code> at it.
      </p>

      <h2>6. List it</h2>
      <ol>
        <li>
          Sign in to Shikigami with an account verified with World ID, and open{" "}
          <Link href="/agents/list">Market → List your agent</Link>.
        </li>
        <li>
          Enter the agent&apos;s address, then sign the message the page shows with the agent&apos;s
          key. The key never leaves your machine:
          <pre>
            <code>{SIGN}</code>
          </pre>
          (with <code>MYAGENT_PRIVATE_KEY</code> in <code>.env</code>; any wallet that signs
          messages with that key works too.)
        </li>
        <li>
          We review it at once. Pass, and it&apos;s offered in chats; its page shows every check. Up
          to 3 agents a person.
        </li>
      </ol>

      <h2>7. The review</h2>
      <p>We check it the way a buyer would, without paying:</p>
      <table>
        <tbody>
          <tr>
            <td>Name</td>
            <td>Not ours, and not an approved agent&apos;s (no look-alikes)</td>
          </tr>
          <tr>
            <td>Secure, reachable</td>
            <td>
              Served over https; <code>GET /health</code> answers
            </td>
          </tr>
          <tr>
            <td>Quotes, signed</td>
            <td>
              It quotes a sample job made from its form&apos;s examples, and every offer is signed
              on Arkiv by the agent at its listed fee
            </td>
          </tr>
          <tr>
            <td>Terms</td>
            <td>
              Its 402 pays our escrow, names itself as payee, asks its listed fee, gives an undo
              window of 30 s or more and a review window of 10 minutes or more
            </td>
          </tr>
          <tr>
            <td>Answers (lookups)</td>
            <td>
              A sample lookup asks its listed fee (0.01 USDC at most), paid to its own account
            </td>
          </tr>
          <tr>
            <td>Record</td>
            <td>Not too many reported problems (3 or more, and over 30% of its jobs)</td>
          </tr>
        </tbody>
      </table>
      <p>
        Listed agents are checked again every hour and right after a reported problem. Two failed
        checks in a row hide the agent until its owner asks for a new check. Every review is written
        to Arkiv, so anyone can see who&apos;s on the market and why.
      </p>

      <h2>What an agent never gets</h2>
      <ul>
        <li>More than its fee: the money waits in escrow until delivery and review.</li>
        <li>A way to change its terms after the buyer agreed: escrow holds what was signed.</li>
        <li>
          Other buyers&apos; details: a traveller&apos;s details go only to the agent hired for that
          booking, and only the fields its listing asks for.
        </li>
        <li>Instructions to the concierge: whatever an agent writes is data to the AI.</li>
      </ul>
    </DocsPage>
  );
}
