import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Abi, toEventSelector, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import { mandateRegistryAbi } from "./abi";

// Built by `forge build` (turbo builds @app/contracts before testing this package).
const artifact = fileURLToPath(
  new URL("../../contracts/out/MandateRegistry.sol/MandateRegistry.json", import.meta.url),
);
const compiled = JSON.parse(readFileSync(artifact, "utf8")).abi as Abi;

const selectors = (abi: Abi, type: "function" | "event" | "error") =>
  abi
    .filter((i) => i.type === type)
    .map((i) => (type === "event" ? toEventSelector(i as never) : toFunctionSelector(i as never)))
    .sort();

describe("mandateRegistryAbi matches the compiled contract", () => {
  it("every function we call exists with the same signature", () => {
    const real = new Set(selectors(compiled, "function"));
    for (const s of selectors(mandateRegistryAbi, "function")) expect(real.has(s), s).toBe(true);
  });

  it("events are identical (but OpenZeppelin's EIP-712 one, never emitted)", () => {
    const real = compiled.filter(
      (i) => i.type !== "event" || (i as { name: string }).name !== "EIP712DomainChanged",
    );
    expect(selectors(mandateRegistryAbi, "event")).toEqual(selectors(real, "event"));
  });

  it("we can name every error the contract can raise", () => {
    const ours = new Set(selectors(mandateRegistryAbi, "error"));
    // OpenZeppelin's EIP-712 name/version checks, only reachable in the constructor.
    const ozInternal = ["InvalidShortString", "StringTooLong"];
    const real = compiled.filter(
      (i) => i.type === "error" && !ozInternal.includes((i as { name: string }).name),
    );
    for (const s of selectors(real, "error")) expect(ours.has(s), s).toBe(true);
  });
});
