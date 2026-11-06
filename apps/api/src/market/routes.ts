import { ARKIV_EXPLORER } from "@app/arkiv";
import { and, count, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { isAddress, recoverMessageAddress } from "viem";
import { z } from "zod";
import { currentUser } from "../auth/current";
import type { Market, MarketAgent } from "../concierge/market";
import type { Db } from "../db/client";
import { type AgentReview, agentReviews } from "../db/schema";
import type { Erc8004Market } from "./identity";
import type { AgentReviewService } from "./reviews";

/** Agents one person may list. */
export const MAX_LISTED = 3;
/** What an agent's key signs to show its owner runs it, for one account. */
export const listMessage = (agent: string, userId: string) =>
  `AgentNet: I run the agent ${agent.toLowerCase()} and list it on AgentNet from account ${userId}`;

const reviewView = (r: AgentReview | null) =>
  r && {
    status: r.status,
    operator: r.operator,
    checks: r.checks,
    note: r.note,
    checkedAt: r.checkedAt.toISOString(),
    arkiv: r.arkivKey ? ARKIV_EXPLORER.entity(r.arkivKey) : null,
  };
const agentView = (a: MarketAgent, r: AgentReview | null) => ({
  address: a.agent,
  name: a.name,
  skill: a.skill,
  title: a.title ?? null,
  description: a.description,
  feeUnits: a.feeUnits,
  service: a.service ?? null,
  delivered: a.delivered,
  disputes: a.disputes ?? 0,
  rating: a.rating ?? null,
  review: reviewView(r),
});

/**
 * The market's agents, public: each with its record and the marketplace's review (GET
 * /market/agents, /market/agents/:address). Listing an agent (signed in, World ID verified):
 * its key signs that this account runs it, then the review decides if it's shown.
 */
export function marketRoutes(
  db: Db,
  d: { market: Market; reviews: AgentReviewService; erc8004?: Erc8004Market },
) {
  const app = new Hono();
  const find = async (address: string) =>
    (await d.market.all()).find((a) => a.agent.toLowerCase() === address.toLowerCase()) ?? null;

  app.get("/market/agents", async (c) => {
    const [agents, reviews] = await Promise.all([d.market.all(), d.reviews.all()]);
    const by = new Map(reviews.map((r) => [r.agent, r]));
    return c.json(agents.map((a) => agentView(a, by.get(a.agent.toLowerCase()) ?? null)));
  });

  app.get("/market/agents/:address", async (c) => {
    const address = c.req.param("address");
    if (!isAddress(address)) return c.json({ error: "not_found" }, 404);
    const a = await find(address);
    if (!a) return c.json({ error: "not_found" }, 404);
    const r = await d.reviews.get(address);
    return c.json({
      ...agentView(a, r),
      form: a.form ?? null,
      endpointHost: new URL(a.endpoint).host,
      erc8004: (await d.erc8004?.view(a.agent, a.endpoint).catch(() => null)) ?? null,
      hederaAccount: a.hederaAccount ?? null,
      links: [
        ...(a.hederaAccount
          ? [
              {
                label: "Its Hedera account",
                url: `https://hashscan.io/testnet/account/${a.hederaAccount}`,
              },
            ]
          : []),
        ...(a.profileKey
          ? [{ label: "Its profile (Arkiv)", url: ARKIV_EXPLORER.entity(a.profileKey) }]
          : []),
        ...(a.listingKey
          ? [{ label: "Its listing (Arkiv)", url: ARKIV_EXPLORER.entity(a.listingKey) }]
          : []),
        ...(r?.arkivKey
          ? [{ label: "Our review (Arkiv)", url: ARKIV_EXPLORER.entity(r.arkivKey) }]
          : []),
      ],
    });
  });

  app.get("/market/list/message", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const agent = c.req.query("agent") ?? "";
    if (!isAddress(agent))
      return c.json({ error: "bad_request", message: "That isn't an address." }, 400);
    return c.json({ message: listMessage(agent, user.id) });
  });

  app.post("/market/list", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const b = z
      .object({
        agent: z.string().refine(isAddress),
        signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!b.success)
      return c.json({ error: "bad_request", message: "An address and a signature." }, 400);
    const agent = b.data.agent.toLowerCase();
    if (!user.worldSub)
      return c.json(
        {
          error: "not_verified",
          message:
            "Prove you're a person with World ID first (Wallet → World ID): each agent has someone who answers for it.",
        },
        403,
      );
    const signer = await recoverMessageAddress({
      message: listMessage(agent, user.id),
      signature: b.data.signature as `0x${string}`,
    }).catch(() => null);
    if (signer?.toLowerCase() !== agent)
      return c.json(
        { error: "bad_signature", message: "That signature isn't from this agent's key." },
        403,
      );
    const a = await find(agent);
    if (!a)
      return c.json(
        {
          error: "not_on_arkiv",
          message:
            "Publish its profile and listing on Arkiv first (the kit does it when the agent starts).",
        },
        404,
      );
    const prev = await d.reviews.get(agent);
    if (prev?.ownerUserId && prev.ownerUserId !== user.id)
      return c.json({ error: "taken", message: "Someone else lists this agent." }, 409);
    if (prev?.operator === "agentnet")
      return c.json({ error: "taken", message: "This is one of ours." }, 409);
    const [mine] = await db
      .select({ n: count() })
      .from(agentReviews)
      .where(and(eq(agentReviews.ownerUserId, user.id), ne(agentReviews.agent, agent)));
    if ((mine?.n ?? 0) >= MAX_LISTED)
      return c.json({ error: "too_many", message: `Up to ${MAX_LISTED} agents a person.` }, 409);
    const r = await d.reviews.review(a, { operator: "verified-person", ownerUserId: user.id });
    return c.json(agentView(a, r));
  });

  // The owner asks for a fresh review (after fixing what failed).
  app.post("/market/agents/:address/check", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "signed_out" }, 401);
    const address = c.req.param("address");
    const r = isAddress(address) ? await d.reviews.get(address) : null;
    const a = r ? await find(address) : null;
    if (!r || !a || r.ownerUserId !== user.id) return c.json({ error: "not_found" }, 404);
    return c.json(
      agentView(a, await d.reviews.review(a, { operator: r.operator, ownerUserId: user.id })),
    );
  });

  return app;
}
