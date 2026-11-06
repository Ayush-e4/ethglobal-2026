import type { Receipt } from "@app/arkiv";
import type { MandateClient } from "@app/mandates";
import type { HederaIds } from "@app/x402";
import { and, count, eq, gte } from "drizzle-orm";
import { keccak256, type LocalAccount, toHex } from "viem";
import type { MarketAgent } from "../concierge/market";
import type { Db } from "../db/client";
import { lookups, type User } from "../db/schema";
import { demoCapsAllow } from "./caps";
import { HireError } from "./errors";
import { demoLimitFor, LOOKUP_TERMS, liveLimit, NeedsLimit } from "./limits";
import { AgentRefused, PayError, payForAnswer } from "./pay";

export const DEMO_LOOKUPS_A_DAY = 20;

/**
 * Asking a lookup agent: its fee per lookup is paid straight to it from the chat's small lookup
 * limit (passkey accounts approve it once with Face ID; demo accounts use the demo wallet within
 * their caps), and the answer comes back at once. Every question is written down.
 */
export function lookupAsker(d: {
  db: Db;
  registry: MandateClient;
  ids: HederaIds;
  concierge: LocalAccount;
  token: `0x${string}`;
  demo: { owner: LocalAccount; accountId: string; caps: { perUser: bigint; total: bigint } };
  ownWallet?: (
    userId: string,
  ) => Promise<{ status: string; address: string; hederaId?: string | null } | null>;
  onPaid?: (receipt: Receipt) => void; // for the public record (Arkiv)
}) {
  // The shared demo wallet pays demo lookups: a daily count per account on top of the caps.
  const demoAsked = async (userId: string) => {
    const [r] = await d.db
      .select({ n: count() })
      .from(lookups)
      .where(
        and(
          eq(lookups.userId, userId),
          eq(lookups.status, "answered"),
          gte(lookups.createdAt, new Date(Date.now() - 24 * 3600 * 1000)),
        ),
      );
    return r?.n ?? 0;
  };
  return async (user: User, chatId: string, agent: MarketAgent, input: Record<string, unknown>) => {
    const fee = BigInt(agent.feeUnits);
    if (agent.kind !== "lookup") throw new HireError(`${agent.name} isn't a lookup agent.`);
    if (user.isDemo && (await demoAsked(user.id)) >= DEMO_LOOKUPS_A_DAY)
      throw new HireError("This demo account's lookups for today are used up. Try again tomorrow.");
    const payee = agent.agent.toLowerCase() as `0x${string}`;
    const [row] = await d.db
      .insert(lookups)
      .values({
        userId: user.id,
        chatId,
        agentName: agent.name,
        agentAddress: payee,
        skill: agent.skill,
        feeUnits: fee,
        input,
      })
      .returning();
    if (!row) throw new Error("could not save the lookup");
    const done = (changes: Partial<typeof row>) =>
      d.db.update(lookups).set(changes).where(eq(lookups.id, row.id));

    let limit: { mandateId: bigint; ownerAccount: string } | null;
    if (user.isDemo) {
      const blocked = await demoCapsAllow(d.db, user.id, fee, d.demo.caps);
      if (blocked) throw new HireError(blocked);
      limit = await demoLimitFor(
        {
          db: d.db,
          registry: d.registry,
          owner: d.demo.owner,
          ownerAccount: d.demo.accountId,
          concierge: d.concierge.address,
          token: d.token,
        },
        chatId,
        payee,
        fee,
        LOOKUP_TERMS,
      );
    } else {
      const w = await d.ownWallet?.(user.id);
      if (w?.status !== "ready" || !w.hederaId)
        throw new HireError("Your Face ID wallet is still being set up. Try again in a moment.");
      limit = await liveLimit(d.db, d.registry, chatId, payee, fee, w.address);
      if (!limit)
        throw new NeedsLimit({
          type: "limit",
          agentName: agent.name,
          payee,
          budgetUnits: LOOKUP_TERMS.budget.toString(),
          capUnits: LOOKUP_TERMS.cap.toString(),
          hours: LOOKUP_TERMS.hours,
          reply: `Limit approved. Ask ${agent.name} again: ${Object.values(input).join(", ")}`,
        });
    }
    try {
      const r = await payForAnswer({
        registry: d.registry,
        ids: d.ids,
        concierge: d.concierge,
        mandateId: limit.mandateId,
        ownerAccount: limit.ownerAccount,
        endpoint: agent.endpoint,
        input,
      });
      await done({ status: "answered", title: r.answer.title, payTx: r.payTx });
      d.onPaid?.({
        job: keccak256(toHex(row.id)), // this lookup
        task: `lookup-${row.id.slice(0, 8)}`,
        mandateId: limit.mandateId.toString(),
        payer: limit.ownerAccount,
        payTo: agent.hederaAccount ?? limit.ownerAccount,
        amountUnits: fee.toString(),
        hederaTx: r.payTx,
      });
      return { ...r, feeUnits: fee };
    } catch (err) {
      await done({
        status: "failed",
        title: err instanceof Error ? err.message.slice(0, 160) : null,
      });
      if (err instanceof AgentRefused) throw new HireError(`${agent.name}: ${err.message}`);
      throw new HireError(
        `${agent.name} couldn't be paid (${err instanceof PayError ? err.message : "payment failed"}). Nothing was charged.`,
      );
    }
  };
}
