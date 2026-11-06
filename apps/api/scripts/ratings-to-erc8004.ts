// Sends every verified rating that's on Arkiv but not yet on ERC-8004 there too, as feedback from
// our concierge (the same path new ratings take). Safe to re-run: each rating goes once.
// Run: pnpm --filter @app/api ratings-to-erc8004
import { Erc8004Client } from "@app/erc8004";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { privateKeyToAccount } from "viem/accounts";
import { connectDb } from "../src/db/client";
import { hires, quotes, ratings } from "../src/db/schema";
import { erc8004Market } from "../src/market/identity";

const key = process.env.CONCIERGE_PRIVATE_KEY as `0x${string}` | undefined;
if (!key || !process.env.DATABASE_URL)
  throw new Error("needs CONCIERGE_PRIVATE_KEY and DATABASE_URL");
const { db } = await connectDb(process.env.DATABASE_URL);
const erc8004 = erc8004Market({
  registry: new Erc8004Client(),
  reporter: privateKeyToAccount(key),
});

const todo = await db
  .select({ r: ratings, endpoint: quotes.endpoint, job: hires.escrowId })
  .from(ratings)
  .innerJoin(hires, eq(hires.id, ratings.hireId))
  .innerJoin(quotes, eq(quotes.key, hires.quoteKey))
  .where(and(eq(ratings.status, "posted"), isNotNull(ratings.arkivKey), isNull(ratings.erc8004Tx)));
for (const { r, endpoint, job } of todo) {
  const tx = await erc8004.feedback({
    agent: r.agent,
    endpoint,
    score: r.score,
    arkivKey: r.arkivKey as string,
    job: job ?? "",
  });
  if (tx)
    await db
      .update(ratings)
      .set({ erc8004Tx: tx })
      .where(and(eq(ratings.rater, r.rater), eq(ratings.agent, r.agent)));
  console.log(
    `${r.agent.slice(0, 10)}… ${r.score}★ → ${tx ? `https://hashscan.io/testnet/transaction/${tx}` : "not sent (no ERC-8004 identity, or see the error above)"}`,
  );
}
console.log(`${todo.length} rating(s) looked at`);
process.exit(0);
