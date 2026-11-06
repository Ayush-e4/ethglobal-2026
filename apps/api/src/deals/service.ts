import { formatUsdc } from "@app/shared";
import { and, count, eq } from "drizzle-orm";
import type { Address } from "viem";
import type { ChatStore } from "../chats/store";
import type { Db } from "../db/client";
import { type DealClaim, dealClaims, type Hire, type User } from "../db/schema";
import type { WalletChain } from "../wallet/chain";
import type { WalletService } from "../wallet/service";
import { DROPS, type Drop, dropAction } from "./drops";
import { type IdkitConfig, ProofError, rpContext, verifyProof } from "./idkit";

export class DealError extends Error {}

/**
 * Deal drops: a limited number of claims, one per person. A claim is proven with World ID (the
 * nullifier for the drop's action is stored, unique), bound to the account, and pays back the
 * fee of the account's next booking once that booking's agent is paid (so a refund or a
 * reported problem never pays it back twice).
 */
export function dealService(
  db: Db,
  d: {
    idkit: IdkitConfig | null;
    wallets: Pick<WalletService, "get">;
    chain: Pick<WalletChain, "gift">;
    chats: Pick<ChatStore, "add">;
    drops?: Drop[];
    fetchImpl?: typeof fetch;
    log?: (line: string) => void;
  },
) {
  const drops = d.drops ?? DROPS;
  const log = d.log ?? ((l: string) => console.error(l));
  const find = (id: string) => drops.find((x) => x.id === id) ?? null;
  const claims = async (dropId: string) =>
    (await db.select({ n: count() }).from(dealClaims).where(eq(dealClaims.dropId, dropId)))[0]?.n ??
    0;
  const mine = async (userId: string, dropId: string) =>
    (
      await db
        .select()
        .from(dealClaims)
        .where(and(eq(dealClaims.userId, userId), eq(dealClaims.dropId, dropId)))
    )[0] ?? null;

  /** Can this account claim this drop now? Says why not. */
  async function open(user: User, dropId: string) {
    const drop = find(dropId);
    if (!drop || drop.endsAt < new Date()) throw new DealError("This deal has ended.");
    if (!d.idkit) throw new DealError("Deals aren't set up on this server.");
    const w = await d.wallets.get(user.id, false);
    if (w?.status !== "ready") throw new DealError("Deals are for accounts with a Face ID wallet.");
    if (await mine(user.id, drop.id)) throw new DealError("You've claimed this one already.");
    if ((await claims(drop.id)) >= drop.total) throw new DealError("All claimed: they're gone.");
    return { drop, idkit: d.idkit };
  }

  return {
    available: () => !!d.idkit,

    async list(user: User) {
      return Promise.all(
        drops.map(async (x) => {
          const c = await mine(user.id, x.id);
          return {
            id: x.id,
            title: x.title,
            detail: x.detail,
            total: x.total,
            left: Math.max(0, x.total - (await claims(x.id))),
            endsAt: x.endsAt.toISOString(),
            mine: c && { status: c.status, hireId: c.hireId, payTx: c.payTx },
          };
        }),
      );
    },

    /** What the browser needs to ask for the proof: our signed request, bound to this account. */
    async start(user: User, dropId: string) {
      const { drop, idkit } = await open(user, dropId);
      const action = dropAction(drop);
      return {
        app_id: idkit.appId,
        action,
        environment: idkit.environment,
        signal: user.id,
        rp_context: rpContext(idkit, action),
      };
    },

    async claim(user: User, dropId: string, proof: unknown): Promise<DealClaim> {
      const { drop, idkit } = await open(user, dropId);
      let nullifier: string;
      try {
        nullifier = await verifyProof(
          idkit,
          proof,
          { action: dropAction(drop), signal: user.id },
          d.fetchImpl,
        );
      } catch (err) {
        throw new DealError(err instanceof ProofError ? err.message : "Couldn't check the proof.");
      }
      const [row] = await db
        .insert(dealClaims)
        .values({ dropId: drop.id, userId: user.id, nullifier })
        .onConflictDoNothing()
        .returning();
      if (!row) throw new DealError("This World ID has claimed it already: one per person.");
      return row;
    },

    /** A booking's agent was paid: pay back its fee if this account has an unused claim. */
    async onReleased(hire: Hire) {
      const [c] = await db
        .select()
        .from(dealClaims)
        .where(and(eq(dealClaims.userId, hire.userId), eq(dealClaims.status, "claimed")))
        .limit(1);
      const drop = c && find(c.dropId);
      if (!c || !drop) return;
      const w = await d.wallets.get(hire.userId, false);
      if (w?.status !== "ready") return;
      const units = hire.feeUnits < drop.maxFeeUnits ? hire.feeUnits : drop.maxFeeUnits;
      // Taken for this hire first, so a second look can't pay twice.
      const took = await db
        .update(dealClaims)
        .set({ status: "applied", hireId: hire.id, updatedAt: new Date() })
        .where(and(eq(dealClaims.id, c.id), eq(dealClaims.status, "claimed")))
        .returning();
      if (took.length === 0) return;
      try {
        const tx = await d.chain.gift(w.address as Address, units);
        await db
          .update(dealClaims)
          .set({ status: "paid", payTx: tx, updatedAt: new Date() })
          .where(eq(dealClaims.id, c.id));
        await d.chats.add(
          hire.chatId,
          "assistant",
          `Deal drop: AgentNet paid back ${hire.agentName}'s ${formatUsdc(units)} USDC fee to your wallet (one per person, checked with World ID).`,
        );
      } catch (err) {
        log(`deals: payback for hire ${hire.id.slice(0, 8)} failed: ${String(err).slice(0, 160)}`);
        await db.update(dealClaims).set({ status: "failed" }).where(eq(dealClaims.id, c.id));
      }
    },
  };
}

export type DealService = ReturnType<typeof dealService>;
