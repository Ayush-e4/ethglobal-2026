import { resolve } from "node:path";
import type { Service } from "@app/shared";
import { z } from "zod";

/**
 * The hotel agents: the same code, each with its own identity, key and Hedera account, and its
 * own way of doing the job. StayWise books the cheapest and is done; PriceGuard charges more and
 * keeps watching the price after booking, rebooking the same room if it gets cheaper.
 */
export const HOTEL_AGENTS = {
  staywise: {
    env: "STAYWISE",
    name: "StayWise",
    port: 8801,
    feeUsd: "$0.02",
    title: "Book a room",
    description:
      "Books hotel rooms in India. Firm prices, free cancellation, pay on delivery with an undo window.",
    service: {
      model: "Book it, done",
      promise:
        "The cheapest firm, refundable rooms I can find, three to choose from. I book once and I'm done.",
    } satisfies Service,
    watches: false,
  },
  priceguard: {
    env: "PRICEGUARD",
    name: "PriceGuard",
    port: 8802,
    feeUsd: "$0.05",
    title: "Book a room, then watch its price",
    description:
      "Books hotel rooms in India, then keeps checking the price until check-in. Pay on delivery.",
    service: {
      model: "Book and keep watching",
      promise:
        "I book a firm, refundable room, then keep checking its price until check-in. If the same room gets cheaper, I rebook it and the difference goes back to you.",
      afterwards: "Watches the room's price until check-in, and rebooks it if it drops",
    } satisfies Service,
    watches: true,
  },
} as const;
export type HotelAgentId = keyof typeof HOTEL_AGENTS;

export type HotelAgentConfig = ReturnType<typeof loadHotelAgentConfig>;

/** An agent's settings: its own key (Hedera account alias + Arkiv writer), LiteAPI sandbox. */
export function loadHotelAgentConfig(
  id: HotelAgentId,
  env: Record<string, string | undefined> = process.env,
) {
  const a = HOTEL_AGENTS[id];
  const setup = "run pnpm --filter @app/agents agents-setup";
  const Env = z.object({
    [`${a.env}_PRIVATE_KEY`]: z.string().regex(/^0x[0-9a-fA-F]{64}$/, setup),
    [`${a.env}_ACCOUNT_ID`]: z.string().regex(/^0\.0\.\d+$/, setup),
    [`${a.env}_PORT`]: z.coerce.number().default(a.port),
    [`${a.env}_URL`]: z.url().optional(),
    LITEAPI_KEY: z.string().startsWith("sand_", "LiteAPI sandbox key (sand_…)"),
    MANDATE_REGISTRY_ID: z.string().regex(/^0\.0\.\d+$/),
    FACILITATOR_URL: z.url().default("http://localhost:8790"),
    WATCH_EVERY_SECONDS: z.coerce.number().min(10).default(600), // how often a watcher re-checks
    DEMO_TOKEN: z.string().min(16).optional(), // enables "simulate a price drop" for the demo
  });
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`${a.name} settings:\n  ${fields.join("\n  ")}`);
  }
  const e = parsed.data as Record<string, string | number | undefined>;
  const port = Number(e[`${a.env}_PORT`]);
  return {
    id,
    ...a,
    key: e[`${a.env}_PRIVATE_KEY`] as `0x${string}`,
    accountId: e[`${a.env}_ACCOUNT_ID`] as string,
    liteApiKey: e.LITEAPI_KEY as string,
    registryId: e.MANDATE_REGISTRY_ID as string,
    facilitatorUrl: e.FACILITATOR_URL as string,
    port,
    publicUrl: (e[`${a.env}_URL`] as string | undefined) ?? `http://localhost:${port}`,
    dataDir: resolve(import.meta.dirname, "../../.data"),
    terms: { undoSeconds: 60, deliverWithinSeconds: 1800, reviewSeconds: 120 },
    watchEveryMs: Number(e.WATCH_EVERY_SECONDS) * 1000,
    demoToken: e.DEMO_TOKEN as string | undefined,
  };
}
