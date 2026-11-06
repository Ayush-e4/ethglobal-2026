import { describe, expect, it } from "vitest";
import type { Hire } from "../db/schema";
import { confirmations } from "./confirmations";
import { type Email, resendEmail, resendTry } from "./resend";

const hire = {
  id: "h1",
  chatId: "c1",
  title: "Park Inn by Radisson Goa Candolim · 10–12 Jan",
  agentName: "StayWise",
  feeUnits: 20_000n,
  payTx: "0.0.11328382@1793936488.549097829",
  guestName: "Asha Test",
  guestEmail: "asha.test@example.com",
} as Hire;

describe("Resend", () => {
  it("says why a send didn't go, for the test button", async () => {
    const t = resendTry("re_test", undefined, (async () =>
      Response.json(
        { message: "You can only send testing emails to your own email address" },
        { status: 403 },
      )) as unknown as typeof fetch);
    expect(await t({ to: "a@example.com", subject: "s", html: "h", text: "t" })).toEqual({
      ok: false,
      error: "You can only send testing emails to your own email address",
    });
    expect(
      await resendTry(undefined)({ to: "a@example.com", subject: "s", html: "h", text: "t" }),
    ).toMatchObject({ ok: false });
  });

  it("is off without a key", async () => {
    let called = false;
    const send = resendEmail(undefined, undefined, (async () => {
      called = true;
      return Response.json({});
    }) as unknown as typeof fetch);
    expect(await send({ to: "a@example.com", subject: "s", html: "h", text: "t" })).toBe(false);
    expect(called).toBe(false);
  });

  it("sends from the test address, and says why when Resend refuses (without the full address)", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let refuse = false;
    const lines: string[] = [];
    const send = resendEmail(
      "re_test",
      undefined,
      (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return refuse
          ? Response.json(
              { message: "You can only send testing emails to your own address" },
              { status: 403 },
            )
          : Response.json({ id: "e1" });
      }) as unknown as typeof fetch,
      (l) => lines.push(l),
    );
    expect(await send({ to: "asha.test@example.com", subject: "s", html: "h", text: "t" })).toBe(
      true,
    );
    const [first] = calls;
    if (!first) throw new Error("nothing sent");
    expect(first.url).toBe("https://api.resend.com/emails");
    expect((first.init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(first.init.body))).toMatchObject({
      from: "AgentNet <onboarding@resend.dev>",
      to: ["asha.test@example.com"],
    });
    refuse = true;
    expect(await send({ to: "asha.test@example.com", subject: "s", html: "h", text: "t" })).toBe(
      false,
    );
    expect(lines.at(-1)).toMatch(/to a…@example\.com not sent: You can only send testing emails/);
  });
});

describe("the guest's confirmations", () => {
  const sent: Email[] = [];
  const c = confirmations(async (e) => {
    sent.push(e);
    return true;
  }, "https://app.example");

  it("booked: to the guest, with the reference, the payment and an honest sandbox note", async () => {
    expect(await c.booked(hire, "Tb8Y44VaX")).toBe(true);
    const e = sent.at(-1);
    expect(e).toMatchObject({
      to: "asha.test@example.com",
      subject: "Booked: Park Inn by Radisson Goa Candolim · 10–12 Jan (ref Tb8Y44VaX)",
    });
    expect(e?.text).toMatch(
      /^Hi Asha, it's booked\.[\s\S]*Booking reference: Tb8Y44VaX[\s\S]*Guest: Asha Test/,
    );
    expect(e?.text).toContain(
      "https://hashscan.io/testnet/transaction/0.0.11328382@1793936488.549097829",
    );
    expect(e?.text).toContain("https://app.example/chat/c1");
    expect(e?.text).toContain("https://app.example/receipts/h1");
    expect(e?.text).toMatch(/test booking in a travel sandbox/);
  });

  it("rebooked: the new reference and what comes back", async () => {
    await c.rebooked(hire, {
      from: 11927,
      to: 11127,
      saved: 800,
      currency: "INR",
      toBookingId: "CMYKh_7JC",
      simulated: true,
    });
    expect(sent.at(-1)?.text).toMatch(
      /New booking reference: CMYKh_7JC[\s\S]*₹11,927 → ₹11,127[\s\S]*Back to you: ₹800/,
    );
    expect(sent.at(-1)?.text).toMatch(/simulated for the demo/);
  });

  it("refunded: why, and that the fee is back", async () => {
    await c.refunded(
      {
        ...hire,
        note: "Refunded after the buyer's report (not_found); the booking is cancelled",
      } as Hire,
      "report",
    );
    expect(sent.at(-1)?.subject).toBe(`Refunded after your report: ${hire.title}`);
    expect(sent.at(-1)?.text).toMatch(
      /StayWise accepted your report: its fee is refunded and the booking is cancelled/,
    );
    await c.refunded({ ...hire, note: null } as Hire, "not_booked");
    expect(sent.at(-1)?.subject).toBe(`Not booked: ${hire.title}`);
    expect(sent.at(-1)?.text).toMatch(/couldn't book it, so it refunded its fee/);
  });

  it("cancelled afterwards: the reference, and that the fee stays paid", async () => {
    await c.cancelled({ ...hire, bookingRef: "Tb8Y44VaX" } as Hire);
    expect(sent.at(-1)).toMatchObject({
      to: "asha.test@example.com",
      subject: `Cancelled: ${hire.title} (ref Tb8Y44VaX)`,
    });
    expect(sent.at(-1)?.text).toMatch(/0\.02 USDC, kept: it booked as promised/);
  });

  it("an app connected: a security notice to the account's own email, without the sandbox note", async () => {
    await c.connected("me@example.com", "Asha", "Claude");
    expect(sent.at(-1)).toMatchObject({
      to: "me@example.com",
      subject: "Claude was connected to your AgentNet account",
    });
    expect(sent.at(-1)?.text).toMatch(
      /If this wasn't you, disconnect it in Wallet → Connected apps/,
    );
    expect(sent.at(-1)?.text).not.toMatch(/travel sandbox/);
  });

  it("a copy goes to the account's own email when the booking is for someone else", async () => {
    const out: Email[] = [];
    const withCopy = confirmations(
      async (e) => {
        out.push(e);
        return true;
      },
      "https://app.example",
      async () => "me@example.com",
    );
    await withCopy.booked(hire, "R1");
    expect(out.map((e) => [e.to, e.subject])).toEqual([
      ["asha.test@example.com", `Booked: ${hire.title} (ref R1)`],
      ["me@example.com", `Copy: Booked: ${hire.title} (ref R1)`],
    ]);
    expect(out[1]?.text).toMatch(/^A copy for you: this went to Asha Test\./);
    out.length = 0;
    await withCopy.booked({ ...hire, guestEmail: "ME@example.com" } as Hire, "R1");
    expect(out).toHaveLength(1); // the same person: once
  });

  it("escapes what it puts in the HTML, and sends nothing without the guest's email", async () => {
    await c.booked({ ...hire, title: "<b>Inn</b> & Spa" } as Hire, "R1");
    expect(sent.at(-1)?.html).toContain("&lt;b&gt;Inn&lt;/b&gt; &amp; Spa");
    const before = sent.length;
    expect(await c.booked({ ...hire, guestEmail: null } as Hire, "R1")).toBe(false);
    expect(sent).toHaveLength(before);
  });
});
