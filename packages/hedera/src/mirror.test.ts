import { describe, expect, it } from "vitest";
import { Mirror, parseAccount, parseMessages, parseTopic } from "./mirror";

describe("mirror parsing", () => {
  it("reads balances as exact bigints", () => {
    const a = parseAccount({
      account: "0.0.5",
      evm_address: "0xabc",
      balance: { balance: 123_456_789, tokens: [{ token_id: "0.0.429274", balance: 10_000 }] },
    });
    expect(a).toEqual({
      id: "0.0.5",
      evmAddress: "0xabc",
      tinybars: BigInt(123_456_789),
      tokens: { "0.0.429274": BigInt(10_000) },
    });
  });

  it("reads who controls a topic", () => {
    const t = parseTopic({
      topic_id: "0.0.9",
      memo: "log",
      admin_key: null,
      submit_key: { _type: "ECDSA_SECP256K1", key: "02aa" },
    });
    expect(t).toEqual({ id: "0.0.9", memo: "log", adminKey: null, submitKey: "02aa" });
  });

  it("decodes messages", () => {
    const [m] = parseMessages({
      messages: [
        {
          sequence_number: 3,
          consensus_timestamp: "1.2",
          message: Buffer.from('{"a":1}').toString("base64"),
        },
      ],
    });
    expect(m).toEqual({ sequence: 3, timestamp: "1.2", text: '{"a":1}' });
  });
});

describe("Mirror", () => {
  it("returns null for an account that doesn't exist", async () => {
    const mirror = new Mirror("https://m", async () => new Response("{}", { status: 404 }));
    expect(await mirror.balances("0.0.1")).toBeNull();
  });

  it("throws on other errors", async () => {
    const mirror = new Mirror("https://m", async () => new Response("{}", { status: 500 }));
    await expect(mirror.balances("0.0.1")).rejects.toThrow("HTTP 500");
  });
});
