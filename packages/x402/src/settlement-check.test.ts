import { describe, expect, it } from "vitest";
import { checkSettlement, type Expected, type MirrorTransaction } from "./settlement-check";

const USDC = "0.0.429274";
const x: Expected = {
  asset: USDC,
  payer: "0.0.10",
  payTo: "0.0.20",
  amount: BigInt(20000),
  feePayer: "0.0.30",
};
const fee = [
  { account: "0.0.30", amount: -5000 },
  { account: "0.0.3", amount: 4000 },
  { account: "0.0.98", amount: 1000 },
];
const good = (): MirrorTransaction[] => [
  { result: "SUCCESS", nonce: 0, transfers: fee, token_transfers: [] },
  {
    result: "SUCCESS",
    nonce: 1,
    token_transfers: [
      { token_id: USDC, account: "0.0.10", amount: -20000 },
      { token_id: USDC, account: "0.0.20", amount: 20000 },
    ],
  },
];

describe("checkSettlement", () => {
  it("accepts exactly amount from payer to payTo, transfers found in a child record", () => {
    expect(checkSettlement(good(), x)).toBeNull();
  });

  it("a SUCCESS receipt with no transfer is a failed settlement", () => {
    expect(checkSettlement([good()[0] as MirrorTransaction], x)?.code).toBe(
      "settlement_payee_credit_mismatch",
    );
  });

  it("refuses a different amount, a third account, another token or a failed child", () => {
    const t = good();
    (t[1] as MirrorTransaction).token_transfers = [
      { token_id: USDC, account: "0.0.10", amount: -20001 },
      { token_id: USDC, account: "0.0.20", amount: 20000 },
      { token_id: USDC, account: "0.0.66", amount: 1 },
    ];
    expect(checkSettlement(t, x)?.code).toBe("settlement_payer_debit_mismatch");

    const third = good();
    third.push({
      result: "SUCCESS",
      nonce: 2,
      token_transfers: [
        { token_id: USDC, account: "0.0.66", amount: -5 },
        { token_id: USDC, account: "0.0.67", amount: 5 },
      ],
    });
    expect(checkSettlement(third, x)?.code).toBe("settlement_unexpected_debit");

    const token = good();
    token.push({
      result: "SUCCESS",
      nonce: 2,
      token_transfers: [{ token_id: "0.0.5", account: "0.0.20", amount: 1 }],
    });
    expect(checkSettlement(token, x)?.code).toBe("settlement_unexpected_transfer");

    const failed = good();
    (failed[1] as MirrorTransaction).result = "CONTRACT_REVERT_EXECUTED";
    expect(checkSettlement(failed, x)?.code).toBe("settlement_status_not_success");
  });

  it("only the fee payer may lose HBAR", () => {
    const t = good();
    (t[0] as MirrorTransaction).transfers = [
      ...fee,
      { account: "0.0.10", amount: -1 },
      { account: "0.0.3", amount: 1 },
    ];
    expect(checkSettlement(t, x)?.code).toBe("settlement_unexpected_debit");
  });
});
