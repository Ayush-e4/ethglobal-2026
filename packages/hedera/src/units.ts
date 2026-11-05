const TINYBARS_PER_HBAR = BigInt(100_000_000);

/** 1_234_500_000n → "12.345 HBAR" (HBAR pays network fees; 1 HBAR = 10^8 tinybars). */
export function formatHbar(tinybars: bigint): string {
  const whole = tinybars / TINYBARS_PER_HBAR;
  const frac = (tinybars % TINYBARS_PER_HBAR).toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""} HBAR`;
}
