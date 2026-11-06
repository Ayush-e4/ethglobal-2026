import { MandateClient, tokenIdToEvmAddress } from "@app/mandates";
import { formatUsdc } from "@app/shared";
import { HederaIds } from "@app/x402";
import { and, eq, gt } from "drizzle-orm";
import { privateKeyToAccount } from "viem/accounts";
import type { Db } from "../db/client";
import { type Hire, hires, type Limit, quotes, type User } from "../db/schema";
import { type Guest, type GuestGate, guestFor } from "../travellers/service";
import type { HumanGate } from "../world/checkpoint";
import { cancelBooking } from "./cancel-booking";
import { demoCapsAllow } from "./caps";
import type { HiringConfig } from "./config";
import { type DisputeHook, type DisputeReason, disputeHire } from "./disputes";
import { HireError } from "./errors";
import {
  demoLimitFor,
  LIMIT_TERMS,
  type LimitTerms,
  limitParams,
  liveLimit,
  NeedsLimit,
} from "./limits";
import { lookupAsker } from "./lookups";
import { AgentRefused, PayError, payAgent, TEST_TRAVELLER } from "./pay";

const USDC_TESTNET = "0.0.429274";

export { HireError } from "./errors";

/**
 * Hiring, the one way money moves from the app: the hire is written down first, then the chat's
 * limit is found or made, then the AI pays over x402 into escrow. Every surface (web, Telegram,
 * Claude) calls this; the follower takes it from there (follow.ts).
 */
/** A passkey account's own Face ID wallet, as the wallet service shows it. */
export type OwnWallet = (
  userId: string,
) => Promise<{ address: string; hederaId: string | null; status: string } | null>;

export function hiringService(
  db: Db,
  cfg: HiringConfig,
  ownWallet?: OwnWallet,
  gates: {
    guest?: GuestGate; // who it's for: the chat's chosen traveller (asked first)
    human?: HumanGate; // larger hires: a person approves with World ID
    onDispute?: DisputeHook; // a reported problem, for the public record
  } = {},
) {
  const { human } = gates;
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
      // What's paid: the agent's fee, plus the trip price when it's held in escrow too.
      const total = quote.feeUnits + (quote.priceUnits ?? 0n);
      const blocked = demo ? await demoCapsAllow(db, user.id, total, cfg.caps) : null;
      if (blocked) throw new HireError(blocked);
      const guest: Guest =
        (await gates.guest?.(user, chatId, {
          key: quoteKey,
          agentName: quote.agentName,
          summary: quote.summary,
        })) ?? TEST_TRAVELLER;
      const sent = guestFor(guest, quote.guestFields ?? []); // only what this agent needs
      const approval = await human?.(user, chatId, {
        key: quoteKey,
        agentName: quote.agentName,
        agentAddress: quote.agentAddress,
        feeUnits: quote.feeUnits,
        summary: quote.summary,
      });
      const payee = quote.agentAddress as `0x${string}`;
      let own: Limit | null = null;
      if (!demo) {
        const w = await ownWallet?.(user.id);
        if (w?.status !== "ready" || !w.hederaId)
          throw new HireError("Your Face ID wallet is still being set up. Try again in a moment.");
        own = await liveLimit(db, registry, chatId, payee, total, w.address);
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

      if (approval && !(await approval.use()))
        throw new HireError("That World ID approval was already used. Ask to book it again.");
      const [hire] = await db
        .insert(hires)
        .values({
          chatId,
          userId: user.id,
          quoteKey,
          agentName: quote.agentName,
          title: quote.summary,
          feeUnits: quote.feeUnits,
          priceUnits: quote.priceUnits,
          demo,
          guestName: `${guest.firstName} ${guest.lastName}`,
          guestEmail: guest.email,
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
            total,
          ));
        const paid = await payAgent({
          registry,
          ids,
          concierge,
          mandateId: limit.mandateId,
          ownerAccount: limit.ownerAccount,
          endpoint: quote.endpoint,
          quoteKey,
          guest: sent,
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
        console.error(`hire ${hire.id.slice(0, 8)}: ${note}: ${String(err).slice(0, 240)}`);
        await save(hire.id, { status: "failed", note });
        if (err instanceof AgentRefused)
          throw new HireError(`${quote.agentName}: ${err.message} Nothing was charged.`);
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
      // Marked first: the follower may look while Hedera is refunding, and must not take it for
      // the agent giving up.
      await save(hire.id, { note: "undoing" });
      await registry.cancel(concierge, hire.escrowId as `0x${string}`).catch(async (err) => {
        await save(hire.id, { note: null });
        throw err;
      });
      const changes = {
        status: "cancelled" as const,
        note: `undone: ${formatUsdc(hire.feeUnits)} USDC back on the limit`,
      };
      await save(hire.id, changes);
      return { ...hire, ...changes };
    },

    /** Cancel a booked stay at the hotel, after the undo window (cancel-booking.ts). */
    cancelBooking: (user: User, chatId: string, hireId: string) =>
      cancelBooking({ db, concierge }, user, chatId, hireId),

    /** Report a problem with a delivered booking, within its review window (disputes.ts). */
    dispute: (user: User, chatId: string, hireId: string, reason: DisputeReason) =>
      disputeHire(
        { db, registry, concierge, onDispute: gates.onDispute },
        user,
        chatId,
        hireId,
        reason,
      ),

    list: (chatId: string) => db.select().from(hires).where(eq(hires.chatId, chatId)),

    /** Ask a lookup agent: its small fee is paid straight to it, the answer comes back (lookups.ts). */
    ask: lookupAsker({
      db,
      registry,
      ids,
      concierge,
      token,
      demo: { owner: demoOwner, accountId: cfg.demoWallet.id, caps: cfg.caps },
      ownWallet,
    }),

    /** A new limit's terms for this agent, and where the registry is (for Face ID approvals). */
    newLimit: (payee: `0x${string}`, terms: LimitTerms = LIMIT_TERMS) =>
      limitParams(concierge.address, token, payee, terms),
    registryAddress: cfg.registry,
  };
}

export type HiringService = ReturnType<typeof hiringService>;
