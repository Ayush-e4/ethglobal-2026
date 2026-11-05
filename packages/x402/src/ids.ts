import type { Address } from "viem";
import { z } from "zod";

const EvmSchema = z.object({ evm_address: z.string().nullable().optional() });
const AccountSchema = z.object({ account: z.string() });
const ContractSchema = z.object({ contract_id: z.string() });
const TokenSchema = z.object({
  custom_fees: z
    .object({
      fixed_fees: z.array(z.unknown()).optional(),
      fractional_fees: z.array(z.unknown()).optional(),
      royalty_fees: z.array(z.unknown()).optional(),
    })
    .optional(),
});

/**
 * Hedera ids (0.0.x) and EVM addresses, through the mirror node. An account with an ECDSA alias
 * must be used by its alias address: its long-zero form doesn't resolve in token calls (spec
 * Prerequisite 4). Results are cached; ids don't change.
 */
export class HederaIds {
  private readonly cache = new Map<string, Promise<unknown>>();

  constructor(
    readonly mirrorUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private get(path: string): Promise<unknown | null> {
    let hit = this.cache.get(path);
    if (!hit) {
      hit = this.fetchImpl(`${this.mirrorUrl}/api/v1${path}`).then(async (res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`mirror ${path}: HTTP ${res.status}`);
        return res.json();
      });
      hit.catch(() => this.cache.delete(path));
      this.cache.set(path, hit);
    }
    return hit;
  }

  /** The EVM address of an account or contract id. */
  async evmAddress(id: string): Promise<Address> {
    for (const kind of ["accounts", "contracts"]) {
      const json = await this.get(`/${kind}/${id}`);
      const evm = json ? EvmSchema.parse(json).evm_address : null;
      if (evm) return evm.toLowerCase() as Address;
    }
    throw new Error(`no EVM address for ${id}`);
  }

  /** The Hedera id behind an EVM address (an account or a contract). */
  async idOf(address: Address): Promise<string> {
    const account = await this.get(`/accounts/${address}`);
    if (account) return AccountSchema.parse(account).account;
    const contract = await this.get(`/contracts/${address}`);
    if (contract) return ContractSchema.parse(contract).contract_id;
    throw new Error(`no Hedera id for ${address}`);
  }

  /** True if the token charges custom fees, which `exact` can't express (spec Prerequisite 6). */
  async hasCustomFees(tokenId: string): Promise<boolean> {
    const json = await this.get(`/tokens/${tokenId}`);
    if (!json) throw new Error(`unknown token ${tokenId}`);
    const fees = TokenSchema.parse(json).custom_fees;
    return [fees?.fixed_fees, fees?.fractional_fees, fees?.royalty_fees].some((f) => f?.length);
  }
}
