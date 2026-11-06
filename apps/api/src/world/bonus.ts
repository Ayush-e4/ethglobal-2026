import { parseUsdc } from "@app/shared";
import { and, count, eq, gte } from "drizzle-orm";
import type { Address } from "viem";
import { z } from "zod";
import type { Db } from "../db/client";
import { worldBonuses } from "../db/schema";
import type { WalletChain } from "../wallet/chain";
import type { WalletService } from "../wallet/service";
import type { Verified } from "./oidc";

const Env = z.object({
  WORLD_BONUS_USDC: z.string().default("0.20"), // test USDC for proving you're a person
  WORLD_BONUSES_PER_DAY: z.coerce.number().int().min(0).default(20), // across everyone
});

export interface BonusOptions {
  units: bigint;
  perDay: number;
  log?: (line: string) => void;
}

export function loadBonusOptions(env: NodeJS.ProcessEnv = process.env): BonusOptions {
  const e = Env.parse(env);
  return { units: parseUsdc(e.WORLD_BONUS_USDC), perDay: e.WORLD_BONUSES_PER_DAY };
}

export type Bonus = typeof worldBonuses.$inferSelect;

/**
 * The welcome bonus: test USDC from the sponsor to a Face ID wallet, once per person. "Person"
 * is their World ID, not the account, so a second account doesn't get a second bonus (and a
 * World ID links to only one account anyway). Recorded before it's sent: never sent twice.
 */
export function worldBonus(
  db: Db,
  chain: Pick<WalletChain, "gift">,
  wallets: Pick<WalletService, "get">,
  opts: BonusOptions,
) {
  const log = opts.log ?? ((line: string) => console.error(line));

  async function capped() {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const [r] = await db
      .select({ n: count() })
      .from(worldBonuses)
      .where(gte(worldBonuses.createdAt, since));
    return (r?.n ?? 0) >= opts.perDay;
  }

  return {
    units: opts.units,

    async get(userId: string): Promise<Bonus | null> {
      const [b] = await db.select().from(worldBonuses).where(eq(worldBonuses.userId, userId));
      return b ?? null;
    },

    /** After a passed check: sends the bonus, or says why not (shown to the person). */
    async give(userId: string, v: Verified): Promise<string | undefined> {
      const w = await wallets.get(userId, false);
      if (w?.status !== "ready") return "your wallet isn't ready yet, so no bonus was sent";
      if (await capped()) return "today's bonuses are all given out: try again tomorrow";
      const [row] = await db
        .insert(worldBonuses)
        .values({ worldIss: v.iss, worldSub: v.sub, userId, units: opts.units })
        .onConflictDoNothing()
        .returning();
      if (!row) return "this World ID has had its bonus already";
      const mine = and(eq(worldBonuses.worldIss, v.iss), eq(worldBonuses.worldSub, v.sub));
      try {
        const tx = await chain.gift(w.address as Address, opts.units);
        await db.update(worldBonuses).set({ status: "sent", tx }).where(mine);
        return undefined;
      } catch (err) {
        log(`world: bonus for ${userId} failed: ${String(err).slice(0, 160)}`);
        await db.update(worldBonuses).set({ status: "failed" }).where(mine);
        return "the bonus didn't go through";
      }
    },
  };
}

export type WorldBonus = ReturnType<typeof worldBonus>;
