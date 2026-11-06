import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Abi, decodeFunctionData, toEventSelector, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import { erc20Abi } from "./abi";
import {
  assertionFromWebAuthn,
  limitCalls,
  passkeyWalletAbi,
  passkeyWalletFactoryAbi,
} from "./passkey-wallet";

// Built by `forge build` (turbo builds @app/contracts before testing this package).
const compiled = (name: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../contracts/out/${name}.sol/${name}.json`, import.meta.url)),
      "utf8",
    ),
  ).abi as Abi;
const selectors = (abi: Abi) =>
  abi.flatMap((i) =>
    i.type === "function"
      ? [toFunctionSelector(i as never)]
      : i.type === "event"
        ? [toEventSelector(i as never)]
        : [],
  );

describe("passkey wallet ABIs match the compiled contracts", () => {
  it.each([
    ["PasskeyWallet", passkeyWalletAbi],
    ["PasskeyWalletFactory", passkeyWalletFactoryAbi],
  ] as const)("%s", (name, ours) => {
    const real = new Set(selectors(compiled(name)));
    for (const s of selectors(ours as Abi)) expect(real.has(s), s).toBe(true);
  });
});

describe("assertionFromWebAuthn", () => {
  it("takes r and s out of the DER signature, low s, and finds type and challenge", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const authData = Buffer.concat([Buffer.alloc(32, 7), Buffer.from([5, 0, 0, 0, 1])]);
    const client = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge: "abc", origin: "http://localhost:3000" }),
    );
    const msg = Buffer.concat([authData, createHash("sha256").update(client).digest()]);
    for (let i = 0; i < 8; i++) {
      const a = assertionFromWebAuthn({
        authenticatorData: authData.toString("base64url"),
        clientDataJSON: client.toString("base64url"),
        signature: sign("sha256", msg, privateKey).toString("base64url"),
      });
      expect(BigInt(a.s) <= 0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8n);
      // r || s still verifies after the flip
      const p1363 = Buffer.from(a.r.slice(2) + a.s.slice(2), "hex");
      expect(verify("sha256", msg, { key: publicKey, dsaEncoding: "ieee-p1363" }, p1363)).toBe(
        true,
      );
      expect(a.clientDataJSON.slice(Number(a.typeIndex))).toMatch(/^"type":"webauthn.get"/);
      expect(a.clientDataJSON.slice(Number(a.challengeIndex))).toMatch(/^"challenge":"abc"/);
      expect(a.authenticatorData).toBe(`0x${authData.toString("hex")}`);
    }
  });
});

describe("limitCalls", () => {
  it("adds the budget to what the registry may already pull, never replacing it", () => {
    const registry = "0x00000000000000000000000000000000000000f1";
    const [approve] = limitCalls(
      registry,
      {
        agent: "0x00000000000000000000000000000000000000a1",
        token: "0x00000000000000000000000000000000000000c1",
        budget: BigInt(100_000),
        perPaymentCap: BigInt(50_000),
        expiresAt: BigInt(1),
        payees: [],
      },
      BigInt(30_000),
    );
    const { args } = decodeFunctionData({ abi: erc20Abi, data: approve?.data ?? "0x" });
    expect(args).toEqual([registry, BigInt(130_000)]);
  });
});
