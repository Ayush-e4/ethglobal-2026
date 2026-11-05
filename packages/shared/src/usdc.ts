/** USDC has 6 decimals. Amounts are kept as bigint base units so no rounding ever happens. */
export const USDC_DECIMALS = 6;
const UNIT = BigInt(10 ** USDC_DECIMALS);
const ZERO = BigInt(0); // no 0n literal: the web app targets ES2017

/** "4.2" → 4200000n. Throws on anything that isn't a plain non-negative amount. */
export function parseUsdc(text: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text.trim());
  if (!m) throw new Error(`not a USDC amount: "${text}"`);
  const [, whole = "0", frac = ""] = m;
  return BigInt(whole) * UNIT + BigInt(frac.padEnd(USDC_DECIMALS, "0"));
}

/** 4200000n → "4.20". Keeps at least 2 decimals, drops trailing zeros after that. */
export function formatUsdc(units: bigint): string {
  const sign = units < ZERO ? "-" : "";
  const abs = units < ZERO ? -units : units;
  const frac = (abs % UNIT).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${sign}${abs / UNIT}.${frac.padEnd(2, "0")}`;
}
