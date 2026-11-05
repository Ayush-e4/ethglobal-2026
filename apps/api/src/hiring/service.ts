import { MandateClient, tokenIdToEvmAddress } from "@app/mandates";
import { formatUsdc } from "@app/shared";
import { HederaIds } from "@app/x402";
import { and, eq, gt } from "drizzle-orm";
import { privateKeyToAccount } from "viem/accounts";
import type { Db } from "../db/client";
import { type Hire, hires, quotes, type User } from "../db/schema";
import { demoCapsAllow } from "./caps";
import type { HiringConfig } from "./config";
import { limitFor } from "./limits";
import { PayError, payAgent } from "./pay";

const USDC_TESTNET = "0.0.429274";

export class HireError extends Error {}

/**
 * Hiring, the one way money moves from the app: the hire is written down first, then the chat's
 * limit is found or made, then the AI pays over x402 into escrow. Every surface (web, Telegram,
 * Claude) calls this; the follower takes it from there (follow.ts).
 */
export function hiringService(db: Db, cfg: HiringConfig) {
  const registry = new MandateClient(cfg.registry);
  const ids = new HederaIds(cfg.mirrorUrl);
  const concierge = privateKeyToAccount(cfg.conciergeKey);
  const demoOwner = privateKeyToAccount(`0x${cfg.demoWallet.key}`);
  const token = tokenIdToEvmAddress(process.env.USDC_TOKEN_ID || USDC_TESTNET);
  const save = async (id: string, changes: Partial<Hire>) => {
    await db
      .update(hires)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(hires.id, id));
  };

  return {
    registry,

    async hire(user: User, chatId: string, quoteKey: string): Promise<Hire> {
      const [quote] = await db
        .select()
        .from(quotes)
        .where(
          and(
            eq(quotes.key, quoteKey),
            eq(quotes.chatId, chatId),
            gt(quotes.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!quote)
        throw new HireError(
          "That quote has expired or isn't from this chat. Ask for fresh prices.",
        );
      // Real accounts get their own Face ID wallet next; for now every account spends from the demo wallet.
      const demo = true;
      const blocked = demo ? await demoCapsAllow(db, user.id, quote.feeUnits, cfg.caps) : null;
      if (blocked) throw new HireError(blocked);

      const [hire] = await db
        .insert(hires)
        .values({
          chatId,
          userId: user.id,
          quoteKey,
          agentName: quote.agentName,
          title: quote.summary,
          feeUnits: quote.feeUnits,
          demo,
        })
        .returning();
      if (!hire) throw new Error("could not save the hire");
      try {
        const limit = await limitFor(
          {
            db,
            registry,
            owner: demoOwner,
            ownerAccount: cfg.demoWallet.id,
            concierge: concierge.address,
            token,
          },
          chatId,
          quote.agentAddress as `0x${string}`,
          quote.feeUnits,
          demo,
        );
        const paid = await payAgent({
          registry,
          ids,
          concierge,
          mandateId: limit.mandateId,
          ownerAccount: limit.ownerAccount,
          endpoint: quote.endpoint,
          quoteKey,
        });
        const changes = {
          status: "held" as const,
          escrowId: paid.escrowId,
          payTx: paid.payTx,
          jobUrl: paid.jobUrl,
          undoUntil: new Date(paid.startsAt * 1000),
        };
        await save(hire.id, changes);
        return { ...hire, ...changes };
      } catch (err) {
        const note = err instanceof PayError ? `payment refused: ${err.message}` : "payment failed";
        await save(hire.id, { status: "failed", note });
        throw new HireError(`${quote.agentName} couldn't be paid (${note}). Nothing was charged.`);
      }
    },

    /** Undo: the limit's owner takes the fee back before the window ends. Nothing is booked. */
    async cancel(user: User, hireId: string): Promise<Hire> {
      const [hire] = await db
        .select()
        .from(hires)
        .where(and(eq(hires.id, hireId), eq(hires.userId, user.id)))
        .limit(1);
      if (!hire?.escrowId) throw new HireError("No such hire.");
      if (hire.status !== "held" || !hire.undoUntil || hire.undoUntil <= new Date()) {
        throw new HireError("Too late to undo: the agent has started.");
      }
      await registry.cancel(demoOwner, hire.escrowId as `0x${string}`);
      const changes = {
        status: "cancelled" as const,
        note: `undone: ${formatUsdc(hire.feeUnits)} USDC back on the limit`,
      };
      await save(hire.id, changes);
      return { ...hire, ...changes };
    },

    list: (chatId: string) => db.select().from(hires).where(eq(hires.chatId, chatId)),
  };
}

export type HiringService = ReturnType<typeof hiringService>;
