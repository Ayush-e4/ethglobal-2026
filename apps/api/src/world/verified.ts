import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { worldChecks } from "../db/schema";

/** Whether this person proved they're a real person with World ID (the "verified" tick). */
export async function worldVerified(db: Db, userId: string) {
  const [c] = await db
    .select({ id: worldChecks.id })
    .from(worldChecks)
    .where(and(eq(worldChecks.userId, userId), eq(worldChecks.status, "verified")))
    .limit(1);
  return !!c;
}
