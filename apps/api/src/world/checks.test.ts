import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../db/client";
import { worldChecks as checkRows, users } from "../db/schema";
import { testDb } from "../test/db";
import { fakeWorld, ISS, now, ORB, token, worldTestKeys } from "../test/world";
import { type WorldCheck, worldChecks } from "./checks";
import type { Poll } from "./oidc";

describe("World ID tokens", () => {
  it("accepts a fresh, Orb-level token for our app", async () => {
    const { client } = await worldTestKeys();
    expect(await client().verify(await token(), now() - 5)).toMatchObject({
      iss: ISS,
      sub: "human-1",
      acr: ORB,
    });
  });

  it.each([
    ["for another app", () => token({}, "app_other"), /aud/],
    ["from before this check", () => token({ auth_time: now() - 600 }), /isn't fresh/],
    ["at a level we don't accept", () => token({ acr: "urn:device" }), /isn't accepted/],
  ])("refuses a token %s", async (_, make, error) => {
    const { client } = await worldTestKeys();
    await expect(client().verify(await make(), now() - 5)).rejects.toThrow(error);
  });
});

let db: Db;
let userId: string;
const poll = vi.fn<(code: string) => Promise<Poll>>();
const onVerified = vi.fn(async () => undefined as string | undefined);
let h: ReturnType<typeof worldChecks>;
let c: { id: string };
const checks = async () => {
  h = worldChecks(
    db,
    await fakeWorld(poll),
    onVerified,
    async () => {},
    () => {},
  );
  return h;
};
// The check runs in the background; wait until it has ended (written to the database).
const settle = () =>
  vi.waitFor(async () => expect((await h.get(c.id, userId))?.status).not.toBe("waiting"));

beforeEach(async () => {
  vi.clearAllMocks();
  db = await testDb();
  const [u] = await db.insert(users).values({}).returning();
  userId = u?.id ?? "";
});

describe("World ID checks", () => {
  it("waits for the person, validates, links their World ID, then unlocks", async () => {
    poll
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "done", idToken: await token() });
    c = await (await checks()).start(userId, "bonus");
    expect(c).toMatchObject({ status: "waiting", userCode: "ABCD-EFGH" });
    expect(JSON.stringify(c)).not.toContain("private-device-code"); // never leaves the server
    await settle();
    expect((await h.get(c.id, userId))?.status).toBe("verified");
    const [check, v] = onVerified.mock.calls[0] as unknown as [WorldCheck, { sub: string }];
    expect(check.purpose).toBe("bonus");
    expect(v.sub).toBe("human-1");
    expect((await db.select().from(users))[0]).toMatchObject({
      worldIss: ISS,
      worldSub: "human-1",
    });
    expect(await h.get(c.id, crypto.randomUUID())).toBeNull(); // someone else's: not found
  });

  it("keeps what the unlock said, for the person to read", async () => {
    onVerified.mockResolvedValueOnce("come back tomorrow");
    poll.mockResolvedValueOnce({ status: "done", idToken: await token() });
    c = await (await checks()).start(userId, "bonus");
    await settle();
    expect(await h.get(c.id, userId)).toMatchObject({
      status: "verified",
      reason: "come back tomorrow",
    });
  });

  it.each([
    ["denied in World App", { status: "denied", error: "access_denied" }, "denied"],
    ["left to expire", { status: "expired", error: "expired_token" }, "expired"],
    ["World is down", { status: "failed", error: "HTTP 503" }, "failed"],
  ] as const)("unlocks nothing when %s", async (_, result, status) => {
    poll.mockResolvedValueOnce(result as Poll);
    c = await (await checks()).start(userId, "bonus");
    await settle();
    expect((await h.get(c.id, userId))?.status).toBe(status);
    expect(onVerified).not.toHaveBeenCalled();
  });

  it("refuses a different World ID than the one linked to the account", async () => {
    await db.update(users).set({ worldIss: ISS, worldSub: "human-1" });
    poll.mockResolvedValueOnce({ status: "done", idToken: await token({ sub: "human-2" }) });
    c = await (await checks()).start(userId, "bonus");
    await settle();
    expect(await h.get(c.id, userId)).toMatchObject({
      status: "mismatch",
      reason: "a different World ID",
    });
    expect(onVerified).not.toHaveBeenCalled();
  });

  it("won't link one World ID to two accounts", async () => {
    await db.insert(users).values({ worldIss: ISS, worldSub: "human-1" });
    poll.mockResolvedValueOnce({ status: "done", idToken: await token() });
    c = await (await checks()).start(userId, "bonus");
    await settle();
    expect((await h.get(c.id, userId))?.reason).toBe("this World ID is linked to another account");
    expect(onVerified).not.toHaveBeenCalled();
  });

  it("refuses a token that isn't fresh for this check", async () => {
    poll.mockResolvedValueOnce({
      status: "done",
      idToken: await token({ auth_time: now() - 3600 }),
    });
    c = await (await checks()).start(userId, "bonus");
    await settle();
    expect((await h.get(c.id, userId))?.status).toBe("failed");
    expect(onVerified).not.toHaveBeenCalled();
  });
});

describe("World ID checks across a restart", () => {
  const row = (expiresInMs: number) => ({
    id: crypto.randomUUID(),
    userId,
    purpose: "bonus" as const,
    userCode: "ABCD-EFGH",
    link: `${ISS}/device`,
    deviceCode: "private-device-code",
    intervalS: 5,
    startedAtS: now(),
    expiresAt: new Date(Date.now() + expiresInMs),
  });

  it("keeps polling a check that was waiting, and unlocks when it passes", async () => {
    const waiting = row(600_000);
    await db.insert(checkRows).values(waiting);
    poll.mockResolvedValueOnce({ status: "done", idToken: await token() });
    c = waiting;
    expect(await (await checks()).resume()).toBe(1);
    await settle();
    expect((await h.get(c.id, userId))?.status).toBe("verified");
    expect(poll).toHaveBeenCalledWith("private-device-code");
    expect(onVerified).toHaveBeenCalledOnce();
  });

  it("marks a check that ran out of time while the server was down as expired", async () => {
    const stale = row(-1_000);
    await db.insert(checkRows).values(stale);
    await (await checks()).resume();
    expect((await h.get(stale.id, userId))?.status).toBe("expired");
    expect(poll).not.toHaveBeenCalled();
  });
});
