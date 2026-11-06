import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import type { Hire } from "../db/schema";
import { testDb } from "../test/db";
import { HireError, type HiringService } from "./service";

const ORIGIN = "http://localhost:3000";
const HIRE_ID = "6f1c2c3e-8a8f-4b7e-9d0a-1c2b3d4e5f60";

/** Hiring without Hedera: one hire per chat, undoable while `late` is false. */
function fakeHiring(late = false) {
  const calls: { chatId: string; hireId: string }[] = [];
  const row = (chatId: string, status: Hire["status"] = "held"): Hire => ({
    id: HIRE_ID,
    chatId,
    userId: "u",
    quoteKey: "0xquote",
    agentName: "StayWise",
    title: "Park Inn · StayWise",
    feeUnits: BigInt(20000),
    demo: true,
    status,
    escrowId: "0xescrow",
    payTx: "0.0.5@1793920154.081520830",
    undoUntil: new Date(Date.now() + 60_000),
    jobUrl: "http://localhost:8801/jobs/secret",
    bookingRef: null,
    note: null,
    watching: false,
    rebooksSeen: 0,
    watchNote: null,
    guestName: null,
    guestEmail: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const hiring = {
    list: async (chatId: string) => [row(chatId)],
    cancel: async (_user: unknown, chatId: string, hireId: string) => {
      calls.push({ chatId, hireId });
      if (late) throw new HireError("Too late to undo: the agent has started.");
      return row(chatId, "cancelled");
    },
  } as unknown as HiringService;
  return { hiring, calls };
}

async function setup(late = false) {
  const fake = fakeHiring(late);
  const app = createApp({
    appOrigin: ORIGIN,
    db: await testDb(),
    auth: {
      site: { rpID: "localhost", origin: ORIGIN, name: "AgentNet" },
      adminUsers: new Set(),
      secureCookies: false,
    },
    concierge: async () => ({ text: "", cards: [] }),
    hiring: fake.hiring,
  });
  const signIn = async () =>
    (await app.request("/auth/demo", { method: "POST" })).headers
      .get("set-cookie")
      ?.split(";")[0] ?? "";
  const call = (path: string, cookie: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { "Content-Type": "application/json", Cookie: cookie } });
  const me = await signIn();
  const chat = (await (await call("/chats", me, { method: "POST", body: "{}" })).json()) as {
    id: string;
  };
  return { call, signIn, me, chat, calls: fake.calls };
}

describe("hire routes", () => {
  it("shows a hire's status without anything internal", async () => {
    const { call, me, chat } = await setup();
    const [hire] = (await (await call(`/chats/${chat.id}/hires`, me)).json()) as Record<
      string,
      unknown
    >[];
    expect(hire).toMatchObject({ id: HIRE_ID, status: "held", feeUnits: "20000" });
    expect(Object.keys(hire ?? {})).not.toContain("jobUrl");
    expect(Object.keys(hire ?? {})).not.toContain("escrowId");
  });

  it("undo cancels in this chat and says so in the chat", async () => {
    const { call, me, chat, calls } = await setup();
    const res = await call(`/chats/${chat.id}/hires/${HIRE_ID}/cancel`, me, { method: "POST" });
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ chatId: chat.id, hireId: HIRE_ID }]);
    const saved = (await (await call(`/chats/${chat.id}`, me)).json()) as {
      messages: { role: string; text: string }[];
    };
    expect(saved.messages.at(-1)?.text).toMatch(/^Undone: Park Inn .* 0\.02 USDC fee is back/);
  });

  it("too late to undo is a 409 with the reason", async () => {
    const { call, me, chat } = await setup(true);
    const res = await call(`/chats/${chat.id}/hires/${HIRE_ID}/cancel`, me, { method: "POST" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { message: string }).message).toMatch(/Too late/);
  });

  it("someone else's chat, or a bad id, is not found", async () => {
    const { call, signIn, chat, calls } = await setup();
    const other = await signIn();
    expect((await call(`/chats/${chat.id}/hires`, other)).status).toBe(404);
    const post = (path: string, who: string) => call(path, who, { method: "POST" });
    expect((await post(`/chats/${chat.id}/hires/${HIRE_ID}/cancel`, other)).status).toBe(404);
    expect((await post(`/chats/${chat.id}/hires/not-a-uuid/cancel`, other)).status).toBe(404);
    expect(calls).toEqual([]);
  });
});
