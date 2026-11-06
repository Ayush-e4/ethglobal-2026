import { describe, expect, it } from "vitest";
import { users } from "../db/schema";
import { testDb } from "../test/db";
import { statsRoutes } from "./stats";

describe("public stats", () => {
  it("counts what the network has done, and nothing about anyone", async () => {
    const db = await testDb();
    await db.insert(users).values([{}, {}, { isDemo: true }]);
    const res = await statsRoutes(db).request("/stats");
    expect(await res.json()).toEqual({
      agents: 0,
      jobs: 0,
      lookups: 0,
      shopPayments: 0,
      people: 2,
    });
  });
});
