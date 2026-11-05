import { z } from "zod";
import { ROLES, type Role } from "./roles";

const env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env;

/** Well-known addresses per network. */
export const NETWORKS = {
  testnet: {
    mirrorUrl: "https://testnet.mirrornode.hedera.com",
    jsonRpcUrl: "https://testnet.hashio.io/api",
    hashscanUrl: "https://hashscan.io/testnet",
    /** Circle's test USDC (6 decimals). After a testnet reset it may get a new id: set USDC_TOKEN_ID. */
    usdcTokenId: env.USDC_TOKEN_ID || "0.0.429274",
  },
  mainnet: {
    mirrorUrl: "https://mainnet.mirrornode.hedera.com",
    jsonRpcUrl: "https://mainnet.hashio.io/api",
    hashscanUrl: "https://hashscan.io/mainnet",
    usdcTokenId: "0.0.456858",
  },
} as const;

export type HederaNetwork = keyof typeof NETWORKS;

/** An account and the key that controls it (raw 32-byte hex, never logged). */
export interface Account {
  id: string;
  key: string;
}

export interface HederaConfig {
  network: HederaNetwork;
  roles: Partial<Record<Role, Account>>;
  spendLogTopicId?: string;
}

const ID = /^0\.0\.\d+$/;
// The portal shows an ECDSA key as hex (optionally 0x…) or DER (that prefix + the same 32 bytes).
const DER_PREFIX = "3030020100300706052b8104000a04220420";
const KEY = new RegExp(`^(0x|${DER_PREFIX})?[0-9a-fA-F]{64}$`);

/** The raw 32-byte hex form of an ECDSA key given as hex, 0x-hex or DER. */
export function normalizeKey(key: string): string {
  return key
    .replace(/^0x/, "")
    .replace(new RegExp(`^${DER_PREFIX}`), "")
    .toLowerCase();
}

const optional = (s: z.ZodString) => s.optional().or(z.literal(""));

/**
 * Reads the network, each role's account and the log topic from env. Errors name the setting,
 * never its value. The operator is required; the others appear after `pnpm setup:testnet`.
 */
export function loadConfig(e: Record<string, string | undefined> = env): HederaConfig {
  const shape: Record<string, z.ZodType> = {
    HEDERA_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
    SPEND_LOG_TOPIC_ID: optional(z.string().regex(ID, "expected 0.0.<number>")),
  };
  for (const [role, r] of Object.entries(ROLES)) {
    const required = role === "operator";
    const id = z.string().regex(ID, "expected 0.0.<number>");
    const key = z.string().regex(KEY, "expected a 32-byte ECDSA key (hex or DER)");
    shape[`${r.env}_ACCOUNT_ID`] = required ? id : optional(id);
    shape[`${r.env}_PRIVATE_KEY`] = required ? key : optional(key);
  }
  const parsed = z.object(shape).safeParse(e);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid Hedera settings in .env:\n  ${fields.join("\n  ")}`);
  }
  const v = parsed.data as Record<string, string | undefined>;
  const roles: HederaConfig["roles"] = {};
  for (const [role, r] of Object.entries(ROLES) as [Role, (typeof ROLES)[Role]][]) {
    const id = v[`${r.env}_ACCOUNT_ID`];
    const key = v[`${r.env}_PRIVATE_KEY`];
    if (id && key) roles[role] = { id, key: normalizeKey(key) };
    else if (id || key) throw new Error(`Set both ${r.env}_ACCOUNT_ID and ${r.env}_PRIVATE_KEY`);
  }
  return {
    network: v.HEDERA_NETWORK as HederaNetwork,
    roles,
    spendLogTopicId: v.SPEND_LOG_TOPIC_ID || undefined,
  };
}

/** The account for `role`, or a clear error saying how to get one. */
export function account(config: HederaConfig, role: Role): Account {
  const a = config.roles[role];
  if (!a) throw new Error(`No ${role} account yet: run pnpm setup:testnet`);
  return a;
}
