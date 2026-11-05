import { resolve } from "node:path";
import { z } from "zod";

/** StayWise's settings: its own key (Hedera account alias + Arkiv writer), LiteAPI sandbox. */
const Env = z.object({
  STAYWISE_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "run pnpm --filter @app/agents agents-setup"),
  STAYWISE_ACCOUNT_ID: z
    .string()
    .regex(/^0\.0\.\d+$/, "run pnpm --filter @app/agents agents-setup"),
  LITEAPI_KEY: z.string().startsWith("sand_", "LiteAPI sandbox key (sand_…)"),
  MANDATE_REGISTRY_ID: z.string().regex(/^0\.0\.\d+$/),
  FACILITATOR_URL: z.url().default("http://localhost:8790"),
  STAYWISE_PORT: z.coerce.number().default(8801),
  STAYWISE_URL: z.url().optional(),
});

export type StayWiseConfig = ReturnType<typeof loadStayWiseConfig>;

export function loadStayWiseConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`StayWise settings:\n  ${fields.join("\n  ")}`);
  }
  const e = parsed.data;
  return {
    key: e.STAYWISE_PRIVATE_KEY as `0x${string}`,
    accountId: e.STAYWISE_ACCOUNT_ID,
    liteApiKey: e.LITEAPI_KEY,
    registryId: e.MANDATE_REGISTRY_ID,
    facilitatorUrl: e.FACILITATOR_URL,
    port: e.STAYWISE_PORT,
    publicUrl: e.STAYWISE_URL ?? `http://localhost:${e.STAYWISE_PORT}`,
    dataDir: resolve(import.meta.dirname, "../../.data"),
    feeUsd: "$0.02",
    terms: { undoSeconds: 60, deliverWithinSeconds: 1800, reviewSeconds: 120 },
  };
}
