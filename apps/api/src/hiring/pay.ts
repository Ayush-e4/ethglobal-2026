import type { MandateClient } from "@app/mandates";
import { type HederaIds, MandateClientScheme, NETWORK, type SignedPayment } from "@app/x402";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import type { LocalAccount } from "viem";
import { z } from "zod";
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
}) {
  let signed: SignedPayment | undefined;
  const scheme = new MandateClientScheme({
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
  return { ...body.data, payTx: payment.transaction, signed };
}
