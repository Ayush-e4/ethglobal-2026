import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { lookupRoutes } from "../jobs/lookup-routes";
import { BANKCHECK_FORM, ifscAnswer } from "./bankcheck";

const RAZORPAY = {
  BANK: "HDFC Bank",
  BRANCH: "SANDOZ HOUSE",
  ADDRESS: "SANDOZ HOUSE, WORLI, MUMBAI",
  CITY: "MUMBAI",
  STATE: "MAHARASHTRA",
  MICR: "400240002",
  UPI: true,
  IMPS: true,
  NEFT: true,
  RTGS: true,
};

describe("Bank Check", () => {
  it("answers from Razorpay's public IFSC data, and null when the code isn't found", async () => {
    const get = vi.fn(async (url: string | URL) =>
      String(url).endsWith("/HDFC0000240")
        ? Response.json(RAZORPAY)
        : new Response("Not Found", { status: 404 }),
    );
    const a = await ifscAnswer("HDFC0000240", get as never);
    expect(a?.title).toMatch(/HDFC Bank/);
    expect(a?.lines.find((l) => l.label === "Takes")?.value).toMatch(/UPI/);
    expect(await ifscAnswer("HDFC0999999", get as never)).toBeNull();
  });

  it("charges only for an answer: bad input is a 400 and nothing found a 404, before payment", async () => {
    const app = new Hono();
    const answer = vi.fn(async (i: Record<string, unknown>) =>
      i.ifsc === "HDFC0000240" ? { title: "HDFC Bank", lines: [], source: "test" } : null,
    );
    lookupRoutes(app, {
      feeUsd: "$0.001",
      accountId: "0.0.4242",
      facilitatorUrl: "http://127.0.0.1:9", // never reached in these cases
      form: BANKCHECK_FORM,
      what: "Look up an IFSC code.",
      answer,
    });
    expect((await app.request("/answer?ifsc=nope")).status).toBe(400);
    const none = await app.request("/answer?ifsc=SBIN0999999");
    expect(none.status).toBe(404);
    expect(await none.json()).toMatchObject({
      message: expect.stringMatching(/nothing was charged/),
    });
    expect(answer).toHaveBeenCalledTimes(1);
  });
});
