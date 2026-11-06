import { type Card, parseUsdc } from "@app/shared";
import { z } from "zod";
import type { User } from "../db/schema";
import type { WorldChecks } from "./checks";

const Env = z.object({
  WORLD_CHECK_FEE_USDC: z.string().default("0.05"), // a hire's payment (fee + trip price) from which a person approves it
});

/** An approval is good for this long after it passed, and for one hire. */
export const APPROVAL_MS = 10 * 60_000;

export function loadCheckpointOptions(env: NodeJS.ProcessEnv = process.env) {
  return { minFeeUnits: parseUsdc(Env.parse(env).WORLD_CHECK_FEE_USDC) };
}

/** Hiring this agent needs a person to approve it with World ID first (the card). */
export class NeedsHuman extends Error {
  constructor(readonly card: Extract<Card, { type: "human" }>) {
    super(`hiring ${card.agentName} needs a World ID approval first`);
  }
}

/**
 * What a "spend" check approves: one payment to this agent, of this amount, in this chat. Not the
 * quote itself: quotes last minutes, so a fresh one from the same agent is still covered.
 */
export const spendRef = (chatId: string, payee: string, feeUnits: bigint) =>
  `${chatId}:${payee.toLowerCase()}:${feeUnits}`;

/**
 * What a hire pays into escrow: the agent's fee plus the trip's price. The check is on this,
 * not the fee alone: a cheap agent booking an expensive hotel is still a large payment.
 */
export const hireTotal = (q: { feeUnits: bigint; priceUnits?: bigint | null }) =>
  q.feeUnits + (q.priceUnits ?? 0n);

export interface GateQuote {
  key: string;
  agentName: string;
  agentAddress: string;
  feeUnits: bigint; // the whole payment: fee + trip price (hireTotal)
  summary: string;
}

/**
 * Asked by hiring before it pays. Null: no approval needed. Otherwise the person's approval,
 * used up only once the payment goes ahead (`use`), so a Face ID step in between doesn't cost
 * them a second check. No approval yet: NeedsHuman, and nothing is paid.
 */
export type HumanGate = (
  user: User,
  chatId: string,
  quote: GateQuote,
) => Promise<{ use(): Promise<boolean> } | null>;

/**
 * The human checkpoint: a hire with a fee of `minFeeUnits` or more needs a fresh World ID
 * approval by a real person of paying that agent that fee, so a bot, a stolen session or a
 * confused model can't make larger payments alone. Smaller hires go ahead as before.
 */
export function humanCheckpoint(checks: WorldChecks, minFeeUnits: bigint): HumanGate {
  return async (user, chatId, quote) => {
    if (quote.feeUnits < minFeeUnits) return null;
    const ref = spendRef(chatId, quote.agentAddress, quote.feeUnits);
    const ok = await checks.approval(user.id, ref, APPROVAL_MS);
    if (ok) return { use: () => checks.use(ok.id) };
    throw new NeedsHuman({
      type: "human",
      agentName: quote.agentName,
      feeUnits: quote.feeUnits.toString(),
      quoteKey: quote.key,
      reply: `Approved with World ID. Book ${quote.summary} (quote ${quote.key.slice(0, 10)}); if that quote has expired, get fresh prices from ${quote.agentName} and book the same one`,
    });
  };
}
