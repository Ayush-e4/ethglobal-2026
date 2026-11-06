import { randomInt } from "node:crypto";
import type { MandateClient } from "@app/mandates";
import { cardMessage, voidCardMessage } from "@app/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { type Hex, isAddress, recoverMessageAddress } from "viem";
import { z } from "zod";
import type { Db } from "../db/client";
import { type AgentCardRow, agentCards, type CardStatus, hires } from "../db/schema";

const VALID_MS = 60 * 60_000; // a card lives an hour: long enough to book
const BRAND = "Visa (simulated)";

const Issue = z.object({
  escrowId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  merchant: z.string().min(1).max(120),
  amount: z.number().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  amountUnits: z.string().regex(/^\d+$/),
  agent: z.string().refine(isAddress),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});
const Void = Issue.pick({ escrowId: true, agent: true, signature: true });

const view = (c: AgentCardRow) => ({
  last4: c.last4,
  brand: BRAND,
  merchant: c.merchant,
  amount: c.amount,
  currency: c.currency,
  status: c.status,
  expiresAt: c.expiresAt.toISOString(),
});

/**
 * AgentNet Cards: a mock issuer of one-time virtual cards that agents pay hotels and airlines
 * with. Nothing reaches a card network. A card is issued only for a job whose escrow on Hedera
 * holds the trip price for the asking agent (the agent's own key signs), locked to one merchant,
 * the exact amount and an hour. It follows the escrow: authorized when the agent books,
 * captured when the escrow pays out, voided when it's refunded. Each change shows on the hire.
 */
export function cardIssuer(db: Db, registry: Pick<MandateClient, "getEscrow">) {
  const get = async (escrowId: string) =>
    (
      await db.select().from(agentCards).where(eq(agentCards.escrowId, escrowId.toLowerCase()))
    )[0] ?? null;
  const set = async (escrowId: string, status: CardStatus) => {
    const [c] = await db
      .update(agentCards)
      .set({ status, updatedAt: new Date() })
      .where(eq(agentCards.escrowId, escrowId.toLowerCase()))
      .returning();
    if (c)
      await db
        .update(hires)
        .set({ card: view(c) })
        .where(eq(hires.escrowId, c.escrowId));
    return c ?? null;
  };

  const routes = new Hono();
  routes.post("/cards/issue", async (c) => {
    const b = Issue.safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: "bad_request" }, 400);
    const r = b.data;
    const signer = await recoverMessageAddress({
      message: cardMessage(r.escrowId, r.amountUnits, r.merchant),
      signature: r.signature as Hex,
    }).catch(() => null);
    if (signer?.toLowerCase() !== r.agent.toLowerCase())
      return c.json({ error: "bad_signature", message: "Not signed by this agent." }, 403);
    const escrow = await registry.getEscrow(r.escrowId as Hex).catch(() => null);
    if (
      !escrow ||
      escrow.state !== "held" ||
      escrow.payee.toLowerCase() !== r.agent.toLowerCase() ||
      escrow.amount < BigInt(r.amountUnits)
    )
      return c.json(
        { error: "not_funded", message: "No escrow holds that price for this agent." },
        409,
      );
    const had = await get(r.escrowId);
    if (had) return c.json({ id: had.id, ...view(had), expiresAt: had.expiresAt.getTime() });
    const last4 = String(randomInt(0, 10_000)).padStart(4, "0");
    const [card] = await db
      .insert(agentCards)
      .values({
        escrowId: r.escrowId.toLowerCase(),
        agent: r.agent.toLowerCase(),
        merchant: r.merchant,
        amount: r.amount,
        currency: r.currency,
        amountUnits: BigInt(r.amountUnits),
        last4,
        expiresAt: new Date(Date.now() + VALID_MS),
      })
      .returning();
    if (!card) throw new Error("could not issue the card");
    await db
      .update(hires)
      .set({ card: view(card) })
      .where(eq(hires.escrowId, card.escrowId));
    // The agent gets the (mock) number once; we keep only the last 4 digits.
    return c.json({
      id: card.id,
      ...view(card),
      expiresAt: card.expiresAt.getTime(),
      number: `400000${String(randomInt(0, 1_000_000)).padStart(6, "0")}${last4}`,
      cvc: String(randomInt(100, 1000)),
    });
  });

  routes.post("/cards/void", async (c) => {
    const b = Void.safeParse(await c.req.json().catch(() => null));
    if (!b.success) return c.json({ error: "bad_request" }, 400);
    const signer = await recoverMessageAddress({
      message: voidCardMessage(b.data.escrowId),
      signature: b.data.signature as Hex,
    }).catch(() => null);
    const card = await get(b.data.escrowId);
    if (!card || signer?.toLowerCase() !== card.agent) return c.json({ error: "not_found" }, 404);
    if (card.status === "authorized") await set(card.escrowId, "voided");
    return c.json({ ok: true });
  });

  return {
    routes,
    get,
    /** The escrow paid out: the card's charge is settled from it. */
    capture: async (escrowId: string) => {
      const card = await get(escrowId);
      if (card?.status === "authorized") await set(escrowId, "captured");
    },
    /** The escrow went back to the buyer: the card's hold is released. */
    voidFor: async (escrowId: string) => {
      const card = await get(escrowId);
      if (card?.status === "authorized") await set(escrowId, "voided");
    },
  };
}

export type CardIssuerService = ReturnType<typeof cardIssuer>;
