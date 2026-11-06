import { createPublicClient, custom, numberToHex } from "viem";
import { estimateFeesPerGas } from "viem/actions";
import { describe, expect, it } from "vitest";
import { hederaTestnet } from "./chain";

/** A node that answers eth_gasPrice with `gasPrice`, and a block whose base fee is in tinybars. */
const node = (gasPrice: bigint) =>
  createPublicClient({
    chain: hederaTestnet,
    transport: custom({
      async request({ method }) {
        if (method === "eth_gasPrice") return numberToHex(gasPrice);
        if (method === "eth_getBlockByNumber") return { baseFeePerGas: "0x7e", number: "0x1" };
        throw new Error(`unexpected ${method}`);
      },
    }),
  });

describe("hederaTestnet fees", () => {
  it("prices from eth_gasPrice with 20% headroom, ignoring a base fee in tinybars", async () => {
    const fees = await estimateFeesPerGas(node(BigInt(1_320_000_000_000)));
    expect(fees.maxFeePerGas).toBe(BigInt(1_584_000_000_000));
    expect(fees.maxPriorityFeePerGas).toBe(BigInt(0));
  });

  it("scales a gas price that came back in tinybars", async () => {
    const fees = await estimateFeesPerGas(node(BigInt(132)));
    expect(fees.maxFeePerGas).toBe(BigInt(1_584_000_000_000));
  });
});
