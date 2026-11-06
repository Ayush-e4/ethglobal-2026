import { describe, expect, it } from "vitest";
import type { Hire } from "../db/schema";
import { confirmations } from "./confirmations";
import { type Email, resendEmail } from "./resend";

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
      /^Hi Asha, your stay is booked\.[\s\S]*Booking reference: Tb8Y44VaX[\s\S]*Guest: Asha Test/,
    );
    expect(e?.text).toContain(
      "https://hashscan.io/testnet/transaction/0.0.11328382@1793936488.549097829",
    );
    expect(e?.text).toContain("https://app.example/chat/c1");
    expect(e?.text).toMatch(/test booking in a hotel sandbox/);
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

  it("escapes what it puts in the HTML, and sends nothing without the guest's email", async () => {
    await c.booked({ ...hire, title: "<b>Inn</b> & Spa" } as Hire, "R1");
    expect(sent.at(-1)?.html).toContain("&lt;b&gt;Inn&lt;/b&gt; &amp; Spa");
    const before = sent.length;
    expect(await c.booked({ ...hire, guestEmail: null } as Hire, "R1")).toBe(false);
    expect(sent).toHaveLength(before);
  });
});
