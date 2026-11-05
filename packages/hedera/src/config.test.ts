import { describe, expect, it } from "vitest";
import { account, loadConfig, normalizeKey } from "./config";

const KEY = "ab".repeat(32);
const base = { HEDERA_ACCOUNT_ID: "0.0.1001", HEDERA_PRIVATE_KEY: `0x${KEY}` };

describe("loadConfig", () => {
  it("needs only the operator; other roles come later", () => {
    const c = loadConfig(base);
    expect(c.network).toBe("testnet");
    expect(c.roles.operator).toEqual({ id: "0.0.1001", key: KEY });
    expect(c.roles.relayer).toBeUndefined();
    expect(() => account(c, "relayer")).toThrow(/pnpm setup:testnet/);
  });

  it("reads every role and the log topic", () => {
    const c = loadConfig({
      ...base,
      RELAYER_ACCOUNT_ID: "0.0.1002",
      RELAYER_PRIVATE_KEY: KEY,
      LOG_WRITER_ACCOUNT_ID: "0.0.1003",
      LOG_WRITER_PRIVATE_KEY: KEY,
      SPEND_LOG_TOPIC_ID: "0.0.1004",
    });
    expect(c.roles.relayer?.id).toBe("0.0.1002");
    expect(c.roles.logWriter?.id).toBe("0.0.1003");
    expect(c.spendLogTopicId).toBe("0.0.1004");
  });

  it("names the bad setting but never prints a key", () => {
    const secret = "cd".repeat(31);
    try {
      loadConfig({ HEDERA_ACCOUNT_ID: "1001", HEDERA_PRIVATE_KEY: secret });
      expect.unreachable();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("HEDERA_ACCOUNT_ID");
      expect(msg).toContain("HEDERA_PRIVATE_KEY");
      expect(msg).not.toContain(secret);
    }
  });

  it("refuses half a role", () => {
    expect(() => loadConfig({ ...base, RELAYER_ACCOUNT_ID: "0.0.1002" })).toThrow(
      /RELAYER_ACCOUNT_ID and RELAYER_PRIVATE_KEY/,
    );
  });
});

describe("normalizeKey", () => {
  it("accepts hex, 0x-hex and the portal's DER form", () => {
    expect(normalizeKey(KEY)).toBe(KEY);
    expect(normalizeKey(`0x${KEY.toUpperCase()}`)).toBe(KEY);
    expect(normalizeKey(`3030020100300706052b8104000a04220420${KEY}`)).toBe(KEY);
  });
});
