import { resolve } from "node:path";
import type { Service } from "@app/shared";
import { z } from "zod";

/** The flight agent: books one passenger's economy flight, one way or return, on Duffel. */
export const SKYHOP = {
  env: "SKYHOP",
  name: "SkyHop",
  port: 8803,
  feeUsd: "$0.03",
  title: "Book a flight",
  description:
    "Books economy flights for one passenger, one way or return, at most one stop. Pay on delivery with an undo window.",
  service: {
    model: "Book it, done",
    promise:
      "Three flights to choose from: the cheapest, the fastest and the most flexible. I re-check the fare before booking and won't book it if it went up.",
  } satisfies Service,
} as const;

export type FlightAgentConfig = ReturnType<typeof loadFlightAgentConfig>;

/** SkyHop's settings: its own key (Hedera account alias + Arkiv writer), Duffel test mode. */
export function loadFlightAgentConfig(env: Record<string, string | undefined> = process.env) {
  const setup = "run pnpm --filter @app/agents agents-setup";
  const parsed = z
    .object({
      SKYHOP_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, setup),
      SKYHOP_ACCOUNT_ID: z.string().regex(/^0\.0\.\d+$/, setup),
      SKYHOP_PORT: z.coerce.number().default(SKYHOP.port),
      SKYHOP_URL: z.url().optional(),
      DUFFEL_ACCESS_TOKEN: z
        .string()
        .startsWith("duffel_test_", "Duffel test token (duffel_test_…)"),
      MANDATE_REGISTRY_ID: z.string().regex(/^0\.0\.\d+$/),
      FACILITATOR_URL: z.url().default("http://localhost:8790"),
      CARDS_URL: z.url().default("http://localhost:8787"), // Shikigami's (mock) card issuer
    })
    .safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`SkyHop settings:\n  ${fields.join("\n  ")}`);
  }
  const e = parsed.data;
  return {
    id: "skyhop" as const,
    ...SKYHOP,
    key: e.SKYHOP_PRIVATE_KEY as `0x${string}`,
    accountId: e.SKYHOP_ACCOUNT_ID,
    duffelToken: e.DUFFEL_ACCESS_TOKEN,
    registryId: e.MANDATE_REGISTRY_ID,
    facilitatorUrl: e.FACILITATOR_URL,
    cardsUrl: e.CARDS_URL,
    port: e.SKYHOP_PORT,
    publicUrl: e.SKYHOP_URL ?? `http://localhost:${e.SKYHOP_PORT}`,
    dataDir: resolve(import.meta.dirname, "../../.data"),
    // 15 minutes to report a problem after the booking is made, before the fee is paid out.
    terms: { undoSeconds: 60, deliverWithinSeconds: 1800, reviewSeconds: 900 },
  };
}
