import { hashscanTx } from "@/lib/api";
import { SuccessMark } from "../SuccessMark";

/** What a slow in-person payment says as time passes (Hedera's steps, plainly). */
export const PAY_WAIT: [number, string][] = [
  [0, "Sending the payment to Hedera…"],
  [5, "Hedera is confirming it…"],
  [15, "A first payment also sets up your spending limit on Hedera: keep this open."],
  [60, "Still going: Hedera is slow right now. Nothing is charged twice."],
];

/** The payer's "Paid" card: the success mark, how much, to whom, and the Hedera proof. */
export function PaidCard(p: {
  inr: number;
  name: string;
  account: string;
  live: boolean;
  tx: string | null;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-white p-6 text-center">
      <SuccessMark />
      <span className="text-sm font-semibold text-ok">Paid</span>
      <span className="text-[30px] font-bold">₹{p.inr.toLocaleString("en-IN")}</span>
      <span className="text-sm text-ink-2">to {p.name}</span>
      <span className="text-xs text-muted">
        {p.live ? "Live screen confirmed" : "Paid without the live check"} · {p.account}
      </span>
      {p.tx && (
        <a
          href={hashscanTx(p.tx)}
          target="_blank"
          rel="noreferrer noopener"
          className="text-xs text-teal underline"
        >
          See it on Hedera
        </a>
      )}
    </div>
  );
}
