/**
 * Settlement rules for `transferExecutor` (spec Phase 4): a SUCCESS receipt isn't proof of
 * payment. Across the transaction and its child records, `payTo` must gain exactly `amount` of
 * the asset, `payer` must lose exactly that, and nothing else may move but the fee payer's HBAR
 * fee (credited to the network's fee accounts).
 */

export interface MirrorTransfer {
  account: string;
  amount: number;
  token_id?: string;
}

export interface MirrorTransaction {
  result: string;
  nonce?: number;
  transfers?: MirrorTransfer[];
  token_transfers?: MirrorTransfer[];
  nft_transfers?: unknown[];
}

export interface Expected {
  asset: string; // token id
  payer: string;
  payTo: string;
  amount: bigint;
  feePayer: string;
}

export type SettlementFailure = { code: string; message: string };

function net(entries: MirrorTransfer[]) {
  const out = new Map<string, bigint>();
  for (const e of entries) out.set(e.account, (out.get(e.account) ?? BigInt(0)) + BigInt(e.amount));
  return out;
}

export function checkSettlement(txs: MirrorTransaction[], x: Expected): SettlementFailure | null {
  const parent = txs.find((t) => !t.nonce);
  if (!parent) return { code: "settlement_check_failed", message: "no parent record" };
  const failed = txs.find((t) => t.result !== "SUCCESS");
  if (failed) return { code: "settlement_status_not_success", message: failed.result };

  const tokens = txs.flatMap((t) => t.token_transfers ?? []);
  const other = tokens.find((t) => t.token_id !== x.asset && t.amount !== 0);
  if (other || txs.some((t) => (t.nft_transfers ?? []).length > 0)) {
    return { code: "settlement_unexpected_transfer", message: "another token or an NFT moved" };
  }
  const asset = net(tokens.filter((t) => t.token_id === x.asset));
  const zero = BigInt(0);
  if ((asset.get(x.payTo) ?? zero) !== x.amount) {
    return {
      code: "settlement_payee_credit_mismatch",
      message: `payTo got ${asset.get(x.payTo) ?? zero}`,
    };
  }
  if ((asset.get(x.payer) ?? zero) !== -x.amount) {
    return {
      code: "settlement_payer_debit_mismatch",
      message: `payer lost ${-(asset.get(x.payer) ?? zero)}`,
    };
  }
  for (const [account, change] of asset) {
    if (account !== x.payTo && account !== x.payer && change !== zero) {
      return { code: "settlement_unexpected_debit", message: `${account} changed by ${change}` };
    }
  }
  const hbar = net(txs.flatMap((t) => t.transfers ?? []));
  for (const [account, change] of hbar) {
    if (change < zero && account !== x.feePayer) {
      return {
        code: "settlement_unexpected_debit",
        message: `${account} lost ${-change} tinybars`,
      };
    }
  }
  return null;
}
