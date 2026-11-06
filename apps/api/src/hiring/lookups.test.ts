import type { MandateClient } from "@app/mandates";
import type { HederaIds } from "@app/x402";
import { eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import type { MarketAgent } from "../concierge/market";
import { chats, lookups, users } from "../db/schema";
import { testDb } from "../test/db";
import { HireError } from "./errors";
import { LOOKUP_TERMS, NeedsLimit } from "./limits";
import { DEMO_LOOKUPS_A_DAY, lookupAsker } from "./lookups";

const bank: MarketAgent = {
  name: "Bank Check",
  skill: "bank-check",
  description: "",
  agent: "0x00000000000000000000000000000000000000B1",
  endpoint: "http://bank",
  feeUnits: "1000",
  delivered: 0,
  kind: "lookup",
};

async function setup(isDemo: boolean) {
  const db = await testDb();
  const [user] = await db.insert(users).values({ isDemo }).returning();
  if (!user) throw new Error("no user");
  const [chat] = await db.insert(chats).values({ userId: user.id, title: "t" }).returning();
  if (!chat) throw new Error("no chat");
  const key = privateKeyToAccount(generatePrivateKey());
  const ask = lookupAsker({
    db,
    registry: {} as MandateClient, // no limit rows: the chain is never asked
    ids: {} as HederaIds,
    concierge: key,
    token: "0x0000000000000000000000000000000000068cda",
    demo: { owner: key, accountId: "0.0.1", caps: { perUser: 250_000n, total: 1_500_000n } },
    ownWallet: async () => ({ status: "ready", address: key.address, hederaId: "0.0.2" }),
  });
  return { db, user, chat, ask };
}

describe("asking a lookup agent", () => {
  it("a passkey account with no lookup limit here approves one first, on the small terms", async () => {
    const { db, user, chat, ask } = await setup(false);
    const err = await ask(user, chat.id, bank, { ifsc: "HDFC0000240" }).catch((e) => e);
    expect(err).toBeInstanceOf(NeedsLimit);
    expect((err as NeedsLimit).card).toMatchObject({
      payee: bank.agent.toLowerCase(),
      budgetUnits: LOOKUP_TERMS.budget.toString(),
      capUnits: LOOKUP_TERMS.cap.toString(),
    });
    // Written down, so the limit route knows this chat asked this agent.
    const rows = await db.select().from(lookups).where(eq(lookups.chatId, chat.id));
    expect(rows.map((r) => [r.agentAddress, r.status])).toEqual([
      [bank.agent.toLowerCase(), "asked"],
    ]);
  });

  it("only lookup agents, and a demo account has a daily count", async () => {
    const { db, user, chat, ask } = await setup(true);
    await expect(ask(user, chat.id, { ...bank, kind: "booking" }, {})).rejects.toThrow(
      /isn't a lookup agent/,
    );
    await db.insert(lookups).values(
      Array.from({ length: DEMO_LOOKUPS_A_DAY }, () => ({
        userId: user.id,
        chatId: chat.id,
        agentName: bank.name,
        agentAddress: bank.agent.toLowerCase(),
        skill: bank.skill,
        feeUnits: 1000n,
        input: {},
        status: "answered" as const,
      })),
    );
    const err = await ask(user, chat.id, bank, { ifsc: "HDFC0000240" }).catch((e) => e);
    expect(err).toBeInstanceOf(HireError);
    expect(String(err)).toMatch(/used up/);
  });
});
