import { hashscanTx, rupeesOf, usdc } from "@/lib/api";
import type { Status } from "./hire-steps";

/** Exact test USDC, trailing zeros dropped: 42333 → "0.042333". */
const exact = (units: bigint) =>
  (Number(units) / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");

/** Where the money is now, by the hire's status. */
const WHERE: Record<Status, (name: string) => [string, string]> = {
  paying: () => ["Paying into escrow on Hedera…", "text-saffron-ink"],
  held: (n) => [`Held in escrow on Hedera, not paid to ${n} yet`, "text-teal"],
  delivered: (n) => [
    `Held in escrow on Hedera until the review ends, then paid to ${n}`,
    "text-teal",
  ],
  released: (n) => [`Paid out to ${n} by Hedera`, "text-ok"],
  cancelled: () => ["Undone: refunded to your wallet in full", "text-ink-3"],
  refunded: () => ["Refunded to your wallet", "text-ink-3"],
  failed: () => ["Didn't go through", "text-bad"],
  disputed: () => ["Frozen in escrow on Hedera while your report is sorted out", "text-bad"],
};

/**
 * The payment, as a receipt: what was paid (trip price + the agent's fee, at testnet scale),
 * where the money is now, and the proof: the transaction on HashScan and the agent's signed
 * offer on Arkiv.
 */
export function PaymentReceipt(p: {
  feeUnits: string;
  priceUnits: string | null;
  payTx: string | null;
  offerUrl: string | null;
  status: Status;
  name: string;
}) {
  const total = BigInt(p.feeUnits) + BigInt(p.priceUnits ?? "0");
  const [where, tone] = WHERE[p.status](p.name);
  const link = "font-semibold text-teal underline underline-offset-2";
  return (
    <section
      aria-label="Payment"
      className="flex flex-col gap-1.5 rounded-xl border border-line bg-side px-3.5 py-3 text-[13px]"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-bold tracking-wider text-muted uppercase">Payment</span>
        <span className="font-mono text-[15px] font-bold text-ink">{exact(total)} USDC</span>
      </div>
      <span className="text-ink-3">
        {p.priceUnits ? `${rupeesOf(p.priceUnits)} trip + ` : ""}
        {usdc(p.feeUnits)} USDC {p.name}&apos;s fee
        {p.priceUnits ? " · testnet scale, ₹1 = 0.000001 USDC" : ""}
      </span>
      <span className={`font-semibold ${tone}`}>{where}</span>
      {(p.payTx || p.offerUrl) && (
        <span className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
          {p.payTx && (
            <a className={link} href={hashscanTx(p.payTx)} target="_blank" rel="noreferrer">
              View on HashScan ↗
            </a>
          )}
          {p.offerUrl && (
            <a className={link} href={p.offerUrl} target="_blank" rel="noreferrer">
              Signed offer on Arkiv ↗
            </a>
          )}
        </span>
      )}
    </section>
  );
}
