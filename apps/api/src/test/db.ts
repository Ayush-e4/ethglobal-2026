import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { type Db, MIGRATIONS_DIR } from "../db/client";
import * as schema from "../db/schema";

// Each test worker migrates one in-memory template; every test gets its own copy.
let template: Promise<PGlite> | null = null;
const migrated = () => {
  template ??= (async () => {
    const pg = new PGlite();
    await migrate(drizzle(pg, { schema }), { migrationsFolder: MIGRATIONS_DIR });
    return pg;
  })();
  return template;
};

/** A real Postgres (PGlite, in memory) with the app's migrations. No Docker needed. */
export async function testDb(): Promise<Db> {
  const pg = (await (await migrated()).clone()) as PGlite;
  return drizzle(pg, { schema }) as unknown as Db;
}
