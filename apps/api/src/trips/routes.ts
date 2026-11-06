import { ARKIV_EXPLORER } from "@app/arkiv";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { currentUser } from "../auth/current";
import type { Db } from "../db/client";
import { chats, hires, ratings } from "../db/schema";
import { show } from "../hiring/routes";
import type { HiringService } from "../hiring/service";

const hashscan = (kind: "transaction" | "contract", id: string) =>
  `https://hashscan.io/testnet/${kind}/${id}`;
const initials = (name: string | null) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w[0]?.toUpperCase()}.`)
    .join(" ");

/**
 * GET /trips: all your bookings, newest first, across chats. GET /receipts/:id: a booking's proof,
 * public by its unguessable id, for anyone to check: the fee's escrow as Hedera holds it now, the
 * payment, and the records on Arkiv. Who it's for shows as initials, the reference only in part.
 */
export function tripRoutes(db: Db, hiring: HiringService) {
  const app = new Hono();

  app.get("/trips", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const rows = await db
      .select({ hire: hires, chatTitle: chats.title })
      .from(hires)
      .innerJoin(chats, eq(chats.id, hires.chatId))
      .where(eq(hires.userId, user.id))
      .orderBy(desc(hires.createdAt))
      .limit(50);
    return c.json(rows.map((r) => ({ ...show(r.hire), chatTitle: r.chatTitle })));
  });

  app.get("/receipts/:id", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "not_found" }, 404);
    const [h] = await db.select().from(hires).where(eq(hires.id, id.data));
    if (!h) return c.json({ error: "not_found" }, 404);
    const escrow = h.escrowId
      ? await hiring.registry.getEscrow(h.escrowId as `0x${string}`).catch(() => null)
      : null;
    const [rating] = await db
      .select({ score: ratings.score, key: ratings.arkivKey })
      .from(ratings)
      .where(eq(ratings.hireId, h.id));
    return c.json({
      title: h.title,
      agentName: h.agentName,
      feeUnits: h.feeUnits.toString(),
      priceUnits: h.priceUnits?.toString() ?? null,
      card: h.card
        ? {
            last4: h.card.last4,
            merchant: h.card.merchant,
            amount: h.card.amount,
            currency: h.card.currency,
            status: h.card.status,
          }
        : null,
      status: h.status,
      bookedAt: h.createdAt.toISOString(),
      guest: initials(h.guestName),
      bookingRef: h.bookingRef ? `${h.bookingRef.slice(0, 3)}…` : null,
      bookingCancelled: !!h.bookingCancelledAt,
      note: h.note,
      escrow: escrow && {
        state: escrow.state,
        amountUnits: escrow.amount.toString(),
        deliveredAt: escrow.deliveredAt
          ? new Date(Number(escrow.deliveredAt) * 1000).toISOString()
          : null,
        reviewSeconds: escrow.reviewSeconds,
      },
      links: [
        ...(h.payTx
          ? [{ label: "The fee paid into escrow (Hedera)", url: hashscan("transaction", h.payTx) }]
          : []),
        {
          label: "The escrow contract (Hedera)",
          url: hashscan("contract", hiring.registryAddress),
        },
        { label: "The agent's signed offer (Arkiv)", url: ARKIV_EXPLORER.entity(h.quoteKey) },
        ...(rating?.key
          ? [
              {
                label: `A verified person's ${rating.score}★ rating (Arkiv)`,
                url: ARKIV_EXPLORER.entity(rating.key),
              },
            ]
          : []),
      ],
    });
  });

  return app;
}
