import { checkForm, type Form, QuoteReplySchema } from "@app/shared";
import { decodePaymentRequiredHeader } from "@x402/core/http";

/** The marketplace's minimums: what every agent's payment terms must give the buyer. */
export const MIN_UNDO_SECONDS = 30;
export const MIN_REVIEW_SECONDS = 600;
export const MAX_DELIVER_SECONDS = 86_400;

export interface Check {
  id: "name" | "secure" | "reachable" | "quotes" | "signed" | "terms" | "record";
  ok: boolean;
  note: string;
}

/** A fake traveller, for asking an agent its payment terms (nothing is paid). */
const PROBE_GUEST = {
  firstName: "Test",
  lastName: "Traveller",
  email: "test.traveller@example.com",
  phone: "+919800000000",
  bornOn: "1990-01-01",
  gender: "m",
};

const day = (d: Date, plus: number) =>
  new Date(d.getTime() + plus * 86_400_000).toISOString().slice(0, 10);

/**
 * A job to ask a quote for, from the agent's own form: each required field from its first
 * example (a past date moves a month ahead; a second date comes two days after the first).
 * Null when a required field has nothing to go on.
 */
export function sampleInput(form: Form, now = new Date()): Record<string, string | number> | null {
  const out: Record<string, string | number> = {};
  let lastDate: string | null = null;
  for (const name of form.required) {
    const f = form.properties[name];
    if (!f) return null;
    const ex = f.examples?.find((e) => !Object.values(out).includes(e));
    if (f.format === "date") {
      const given = typeof ex === "string" && ex > day(now, 2) ? ex : day(now, 30);
      const v: string = lastDate && given <= lastDate ? day(new Date(lastDate), 2) : given;
      out[name] = v;
      lastDate = v;
    } else if (ex !== undefined) out[name] = ex;
    else if (f.enum?.[0] !== undefined) out[name] = f.enum[0];
    else if (f.type === "integer" || f.type === "number") out[name] = f.minimum ?? 1;
    else return null;
  }
  return checkForm(form, out).ok ? out : null;
}

export interface Probed {
  agent: `0x${string}`;
  endpoint: string;
  feeUnits: string; // its listing's fee
  form?: Form;
  delivered: number;
  disputes?: number;
}

/**
 * Checks an agent from the outside, as a buyer would meet it, without paying anything: served
 * over https; up; quotes a sample job; each offer signed on Arkiv by the agent at its listed fee;
 * payment terms that hold the fee in our escrow for the agent itself, with an undo window and a
 * review window; and a record without too many reported problems.
 */
export async function checkAgent(
  a: Probed,
  d: {
    registryId: string; // our escrow (Hedera contract id)
    signedQuotes: (task: string) => Promise<Set<string>>; // `${key}|${creator}`, lowercase
    allowLocalHttp?: boolean; // development: our own agents on localhost
    fetchImpl?: typeof fetch;
  },
): Promise<Check[]> {
  const get = d.fetchImpl ?? fetch;
  const checks: Check[] = [];
  const add = (id: Check["id"], ok: boolean, note: string) => {
    checks.push({ id, ok, note: note.slice(0, 200) });
    return ok;
  };
  const url = new URL(a.endpoint);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  add(
    "secure",
    url.protocol === "https:" || (!!d.allowLocalHttp && local),
    url.protocol === "https:"
      ? "Served over https"
      : d.allowLocalHttp && local
        ? "A local address, allowed while developing"
        : "Not served over https",
  );
  const base = a.endpoint.endsWith("/") ? a.endpoint : `${a.endpoint}/`;
  const health = await get(new URL("health", base), { signal: AbortSignal.timeout(8000) }).catch(
    () => null,
  );
  if (
    !add(
      "reachable",
      !!health?.ok,
      health?.ok ? "Up" : `Not answering (${health?.status ?? "no reply"})`,
    )
  )
    return checks;

  const input = a.form ? sampleInput(a.form) : null;
  if (!input) {
    add("quotes", false, "Its form has no examples to ask a sample quote with");
    return checks;
  }
  const task = `check-${Date.now().toString(36)}`;
  const q = new URL("quote", base);
  q.searchParams.set("task", task);
  for (const [k, v] of Object.entries(input)) q.searchParams.set(k, String(v));
  const reply = QuoteReplySchema.safeParse(
    await get(q, { signal: AbortSignal.timeout(60_000) })
      .then((r) => r.json())
      .catch(() => null),
  );
  if (
    !add(
      "quotes",
      reply.success,
      reply.success
        ? `Quoted ${reply.data.offers.length} offers for a sample job`
        : "No valid offers for a sample job",
    )
  )
    return checks;
  const offers = reply.success ? reply.data.offers : [];

  let signed = await d.signedQuotes(task);
  if (offers.some((o) => !signed.has(`${o.key}|${a.agent}`.toLowerCase()))) {
    await new Promise((r) => setTimeout(r, 2500)); // Arkiv can lag a block
    signed = await d.signedQuotes(task);
  }
  const unsigned = offers.filter((o) => !signed.has(`${o.key}|${a.agent}`.toLowerCase()));
  const wrongFee = offers.filter((o) => o.feeUnits !== a.feeUnits);
  add(
    "signed",
    unsigned.length === 0 && wrongFee.length === 0,
    unsigned.length
      ? `${unsigned.length} offers not signed on Arkiv by the agent`
      : wrongFee.length
        ? "An offer's fee differs from its listing"
        : "Every offer signed on Arkiv by the agent, at its listed fee",
  );

  // Its payment terms: ask to book without paying (the paywall answers 402 with them).
  const first = offers[0];
  const book = first
    ? await get(new URL("book", base), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quote: first.key, guest: PROBE_GUEST }),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null)
    : null;
  const header = book?.status === 402 ? book.headers.get("payment-required") : null;
  let terms: ReturnType<typeof decodePaymentRequiredHeader> | null = null;
  try {
    terms = header ? decodePaymentRequiredHeader(header) : null;
  } catch {
    terms = null;
  }
  const t = terms?.accepts[0];
  const escrow = (t?.extra as { escrow?: Record<string, unknown> } | undefined)?.escrow;
  const problems = !t
    ? ["it didn't ask for payment through x402"]
    : [
        t.payTo !== d.registryId && "the fee doesn't go into our escrow",
        String(escrow?.payee ?? "").toLowerCase() !== a.agent.toLowerCase() &&
          "the escrow pays someone else",
        t.amount !== a.feeUnits && "it asks a different fee from its listing",
        !(Number(escrow?.undoSeconds) >= MIN_UNDO_SECONDS) &&
          `the undo window is under ${MIN_UNDO_SECONDS} s`,
        !(Number(escrow?.reviewSeconds) >= MIN_REVIEW_SECONDS) &&
          `the review window is under ${MIN_REVIEW_SECONDS / 60} minutes`,
        !(Number(escrow?.deliverWithinSeconds) <= MAX_DELIVER_SECONDS) &&
          "it may take over a day to deliver",
      ].filter((p): p is string => typeof p === "string");
  add(
    "terms",
    problems.length === 0,
    problems.length
      ? `Payment terms: ${problems.join("; ")}`
      : `Fee held in escrow; undo ${escrow?.undoSeconds} s, review ${Math.round(Number(escrow?.reviewSeconds) / 60)} min`,
  );

  const disputes = a.disputes ?? 0;
  const tooMany = disputes >= 3 && disputes > a.delivered * 0.3;
  add(
    "record",
    !tooMany,
    `${a.delivered} jobs delivered, ${disputes} reported${tooMany ? ": too many problems" : ""}`,
  );
  return checks;
}
