import { type Account, account, loadConfig as loadHedera } from "@app/hedera";
import { z } from "zod";

const Env = z.object({
  CONCIERGE_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "run pnpm --filter @app/api hiring-setup"),
  MANDATE_REGISTRY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  MANDATE_REGISTRY_ID: z.string().regex(/^0\.0\.\d+$/),
  FACILITATOR_URL: z.url().default("http://localhost:8790"),
  DEMO_PER_USER_PER_DAY: z.coerce.bigint().default(BigInt(60_000)), // 0.06 USDC of fees per demo account a day
  DEMO_TOTAL_PER_DAY: z.coerce.bigint().default(BigInt(500_000)), // 0.50 USDC a day across all demo accounts
});

export interface HiringConfig {
  conciergeKey: `0x${string}`; // the AI's signing key: signs payments only within a limit
  demoWallet: Account; // owns demo users' limits
  registry: `0x${string}`;
  registryId: string;
  network: "testnet" | "mainnet";
  mirrorUrl: string;
  caps: { perUser: bigint; total: bigint };
}

export function loadHiringConfig(
  env: Record<string, string | undefined> = process.env,
): HiringConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Hiring settings:\n  ${fields.join("\n  ")}`);
  }
  const hedera = loadHedera(env);
  const e = parsed.data;
  return {
    conciergeKey: e.CONCIERGE_PRIVATE_KEY as `0x${string}`,
    demoWallet: account(hedera, "demoWallet"),
    registry: e.MANDATE_REGISTRY_ADDRESS as `0x${string}`,
    registryId: e.MANDATE_REGISTRY_ID,
    network: hedera.network,
    mirrorUrl:
      hedera.network === "mainnet"
        ? "https://mainnet.mirrornode.hedera.com"
        : "https://testnet.mirrornode.hedera.com",
    caps: { perUser: e.DEMO_PER_USER_PER_DAY, total: e.DEMO_TOTAL_PER_DAY },
  };
}
