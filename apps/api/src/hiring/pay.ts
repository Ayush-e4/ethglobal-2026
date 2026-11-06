import type { MandateClient } from "@app/mandates";
import { AnswerSchema } from "@app/shared";
import { type HederaIds, MandateClientScheme, NETWORK, type SignedPayment } from "@app/x402";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import type { LocalAccount } from "viem";
import { z } from "zod";
import { MIN_REVIEW_SECONDS } from "../market/checks";
import type { Guest } from "../travellers/service";

/** Who a booking is for when no traveller was chosen (scripts and tests): a test traveller. */
export const TEST_TRAVELLER = {
  firstName: "Test",
  lastName: "Traveller",
  email: "test.traveller@example.com",
  phone: "+919800000000",
};

const Accepted = z.object({ escrowId: z.string(), startsAt: z.number(), jobUrl: z.url() });

export class PayError extends Error {}

/**
 * A lookup: the AI's key pays the agent's fee straight to it (no escrow: the answer is the
 * delivery), and the answer comes back in the same request. A lookup with no answer is refused
 * before any payment is asked for.
 */
export async function payForAnswer(d: {
  registry: MandateClient;
  ids: HederaIds;
  concierge: LocalAccount;
  mandateId: bigint;
  ownerAccount: string;
  endpoint: string;
  input: Record<string, unknown>;
  expect: { maxAmount: bigint; payee: `0x${string}` }; // its listed fee, to it
}) {
  const scheme = new MandateClientScheme({
    expect: d.expect,
    agent: d.concierge,
    mandateId: d.mandateId,
    owner: d.ownerAccount,
    registry: d.registry,
    ids: d.ids,
  });
  const pay = wrapFetchWithPayment(fetch, new x402Client().register(NETWORK, scheme));
  const url = new URL("answer", d.endpoint.endsWith("/") ? d.endpoint : `${d.endpoint}/`);
  for (const [k, v] of Object.entries(d.input)) url.searchParams.set(k, String(v));
  const res = await pay(url, { signal: AbortSignal.timeout(60_000) });
  const json = (await res.json().catch(() => null)) as {
    answer?: unknown;
    message?: string;
  } | null;
  if (res.status === 404)
    throw new AgentRefused(json?.message ?? "Nothing found: nothing was charged.");
  const settled = res.headers.get("PAYMENT-RESPONSE");
  const payment = settled ? decodePaymentResponseHeader(settled) : null;
  const answer = AnswerSchema.safeParse(json?.answer);
  if (!res.ok || !payment?.success || !answer.success)
    throw new PayError(
      payment && !payment.success ? (payment.errorReason ?? "refused") : `HTTP ${res.status}`,
    );
  return { answer: answer.data, payTx: payment.transaction };
}
/** The agent refused before anything was paid, and said why (e.g. a flight needs a birth date). */
export class AgentRefused extends PayError {}

/**
 * The one payment path: the AI's key signs an x402 payment its limit allows (held in escrow,
 * with an undo window of at least 30 s), and the agent's paywall settles it through our
 * facilitator. Returns where the money is held and how to follow the job.
 */
export async function payAgent(d: {
  registry: MandateClient;
  ids: HederaIds;
  concierge: LocalAccount;
  mandateId: bigint;
  ownerAccount: string;
  endpoint: string;
  quoteKey: string;
  guest: Guest; // only to this agent
  expect: { maxAmount: bigint; payee: `0x${string}` }; // the quote's fee + price, to its agent
}) {
  let signed: SignedPayment | undefined;
  const scheme = new MandateClientScheme({
    // Held in escrow, with the market's minimum review window: never more or other than quoted.
    expect: { ...d.expect, escrowOnly: true, minReviewSeconds: MIN_REVIEW_SECONDS },
    agent: d.concierge,
    mandateId: d.mandateId,
    owner: d.ownerAccount,
    registry: d.registry,
    ids: d.ids,
    minUndoSeconds: 30,
    onSigned: (p) => {
      signed = p;
    },
  });
  const pay = wrapFetchWithPayment(fetch, new x402Client().register(NETWORK, scheme));
  const url = new URL("book", d.endpoint.endsWith("/") ? d.endpoint : `${d.endpoint}/`);
  const res = await pay(url, {
    method: "POST",
    // The agent prices the payment from this quote: its fee plus the trip price.
    headers: { "Content-Type": "application/json", "x-quote": d.quoteKey },
    body: JSON.stringify({ quote: d.quoteKey, guest: d.guest }),
    signal: AbortSignal.timeout(120_000),
  });
  const settled = res.headers.get("PAYMENT-RESPONSE");
  const payment = settled ? decodePaymentResponseHeader(settled) : null;
  const json = (await res.json().catch(() => null)) as { message?: unknown } | null;
  if (res.status === 422 && typeof json?.message === "string")
    throw new AgentRefused(json.message.slice(0, 300));
  const body = Accepted.safeParse(json);
  if (res.status !== 202 || !body.success || !payment?.success) {
    const why =
      payment && !payment.success
        ? `${payment.errorReason}${payment.errorMessage ? ` (${payment.errorMessage})` : ""}`
        : `HTTP ${res.status}`;
    throw new PayError(why);
  }
  return { ...trustedJob(d.endpoint, signed, body.data), payTx: payment.transaction, signed };
}

/**
 * What we act on later (undo, a report, cancelling the booking, following the job) must be what
 * we paid, never what the agent says: the escrow is the one our own signature created (its id
 * comes from our limit and nonce), and the job is followed at the agent's listed address. An agent
 * naming another escrow (someone else's) or a link elsewhere is ignored and logged.
 */
export function trustedJob(
  endpoint: string,
  signed: SignedPayment | undefined,
  said: { escrowId: string; startsAt: number; jobUrl: string },
) {
  if (signed?.kind !== "held" || !signed.escrowId)
    throw new PayError("the payment wasn't held in escrow");
  const escrowId = signed.escrowId.toLowerCase() as `0x${string}`;
  if (said.escrowId.toLowerCase() !== escrowId)
    console.error(
      `agent at ${new URL(endpoint).host} named escrow ${said.escrowId}, not ours: ignored`,
    );
  const base = endpoint.endsWith("/") ? endpoint : `${endpoint}/`;
  return {
    escrowId,
    startsAt: said.startsAt,
    jobUrl: new URL(`jobs/${escrowId}`, base).toString(),
  };
}
