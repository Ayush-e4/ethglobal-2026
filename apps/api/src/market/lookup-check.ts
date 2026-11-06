import { decodePaymentRequiredHeader } from "@x402/core/http";

/** A lookup's fee is tiny: at most 0.01 USDC. Anything dearer is a job, with a quote and escrow. */
export const MAX_LOOKUP_UNITS = 10_000n;

/**
 * A lookup agent, checked as a buyer meets it without paying: a sample lookup (from its form)
 * is asked for payment over x402, at its listed fee, paid to its own Hedera account.
 */
export async function lookupProblems(
  a: { endpoint: string; feeUnits: string; hederaAccount?: string },
  input: Record<string, string | number>,
  get: typeof fetch,
): Promise<string[]> {
  const base = a.endpoint.endsWith("/") ? a.endpoint : `${a.endpoint}/`;
  const url = new URL("answer", base);
  for (const [k, v] of Object.entries(input)) url.searchParams.set(k, String(v));
  const res = await get(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  const header = res?.status === 402 ? res.headers.get("payment-required") : null;
  let t: ReturnType<typeof decodePaymentRequiredHeader>["accepts"][number] | undefined;
  try {
    t = header ? decodePaymentRequiredHeader(header).accepts[0] : undefined;
  } catch {
    t = undefined;
  }
  if (!t)
    return [
      res?.status === 404
        ? "it found nothing for its own example"
        : "it didn't ask for payment through x402",
    ];
  return [
    !a.hederaAccount && "its listing has no Hedera account",
    a.hederaAccount && t.payTo !== a.hederaAccount && "the fee goes to someone else",
    t.amount !== a.feeUnits && "it asks something other than its listed fee",
    BigInt(a.feeUnits) > MAX_LOOKUP_UNITS && "over 0.01 USDC a lookup",
  ].filter((p): p is string => typeof p === "string");
}
