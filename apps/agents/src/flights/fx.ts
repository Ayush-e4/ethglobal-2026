/**
 * Today's exchange rate to rupees, for showing a fare in INR (Duffel's test account prices in
 * GBP). A free daily rate (open.er-api.com), kept for 6 hours; none when it can't be fetched,
 * and then the fare shows in its own currency.
 */
const TTL_MS = 6 * 60 * 60_000;

export function inrRates(fetchImpl: typeof fetch = fetch) {
  const cache = new Map<string, { at: number; rate: number | null }>();
  return async (currency: string): Promise<number | null> => {
    if (currency === "INR") return 1;
    const hit = cache.get(currency);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.rate;
    const body = (await fetchImpl(
      `https://open.er-api.com/v6/latest/${encodeURIComponent(currency)}`,
      {
        signal: AbortSignal.timeout(8000),
      },
    )
      .then((r) => r.json())
      .catch(() => null)) as { result?: string; rates?: Record<string, number> } | null;
    const rate = body?.result === "success" ? (body.rates?.INR ?? null) : null;
    cache.set(currency, { at: Date.now(), rate });
    return rate;
  };
}
export type InrRate = ReturnType<typeof inrRates>;

/** 5723.4 → "₹5,723" */
export const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
