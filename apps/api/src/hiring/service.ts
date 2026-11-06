import { MandateClient, tokenIdToEvmAddress } from "@app/mandates";
import { formatUsdc } from "@app/shared";
import { HederaIds } from "@app/x402";
import { and, eq, gt } from "drizzle-orm";
import { privateKeyToAccount } from "viem/accounts";
import type { Db } from "../db/client";
import { type Hire, hires, type Limit, quotes, type User } from "../db/schema";
import { demoCapsAllow } from "./caps";
import type { HiringConfig } from "./config";
import { demoLimitFor, LIMIT_TERMS, limitParams, liveLimit, NeedsLimit } from "./limits";
import { PayError, payAgent } from "./pay";

const USDC_TESTNET = "0.0.429274";

export class HireError extends Error {}

/**
 * Hiring, the one way money moves from the app: the hire is written down first, then the chat's
 * limit is found or made, then the AI pays over x402 into escrow. Every surface (web, Telegram,
 * Claude) calls this; the follower takes it from there (follow.ts).
 */
/** A passkey account's own Face ID wallet, as the wallet service shows it. */
export type OwnWallet = (
  userId: string,
) => Promise<{ address: string; hederaId: string | null; status: string } | null>;

export function hiringService(db: Db, cfg: HiringConfig, ownWallet?: OwnWallet) {
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
      // Demo accounts spend from the shared demo wallet, within daily caps. Passkey accounts
      // spend from their own Face ID wallet, through a limit they approved for this agent here.
      const demo = user.isDemo;
      const blocked = demo ? await demoCapsAllow(db, user.id, quote.feeUnits, cfg.caps) : null;
      if (blocked) throw new HireError(blocked);
      const payee = quote.agentAddress as `0x${string}`;
      let own: Limit | null = null;
      if (!demo) {
        const w = await ownWallet?.(user.id);
        if (w?.status !== "ready" || !w.hederaId)
          throw new HireError("Your Face ID wallet is still being set up. Try again in a moment.");
        own = await liveLimit(db, registry, chatId, payee, quote.feeUnits, w.address);
        if (!own)
          throw new NeedsLimit({
            type: "limit",
            agentName: quote.agentName,
            payee,
            budgetUnits: LIMIT_TERMS.budget.toString(),
            capUnits: LIMIT_TERMS.cap.toString(),
            hours: LIMIT_TERMS.hours,
            reply: `Limit approved. Book ${quote.summary} (quote ${quoteKey.slice(0, 10)})`,
          });
      }

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
        const limit =
          own ??
          (await demoLimitFor(
            {
              db,
              registry,
              owner: demoOwner,
              ownerAccount: cfg.demoWallet.id,
              concierge: concierge.address,
              token,
            },
            chatId,
            payee,
            quote.feeUnits,
          ));
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

    /** Undo: the fee goes back on the limit before the window ends. Nothing is booked. */
    async cancel(user: User, chatId: string, hireId: string): Promise<Hire> {
      const [hire] = await db
        .select()
        .from(hires)
        .where(and(eq(hires.id, hireId), eq(hires.chatId, chatId), eq(hires.userId, user.id)))
        .limit(1);
      if (!hire?.escrowId) throw new HireError("No such hire.");
      if (hire.status !== "held" || !hire.undoUntil || hire.undoUntil <= new Date()) {
        throw new HireError("Too late to undo: the agent has started.");
      }
      // The concierge undoes it: it's the AI key on every limit (the escrow lets the owner or the
      // AI cancel during the window), so this works for Face ID wallets' limits too, no Face ID.
      await registry.cancel(concierge, hire.escrowId as `0x${string}`);
      const changes = {
        status: "cancelled" as const,
        note: `undone: ${formatUsdc(hire.feeUnits)} USDC back on the limit`,
      };
      await save(hire.id, changes);
      return { ...hire, ...changes };
    },

    list: (chatId: string) => db.select().from(hires).where(eq(hires.chatId, chatId)),

    /** A new limit's terms for this agent, and where the registry is (for Face ID approvals). */
    newLimit: (payee: `0x${string}`) => limitParams(concierge.address, token, payee),
    registryAddress: cfg.registry,
  };
}

export type HiringService = ReturnType<typeof hiringService>;
