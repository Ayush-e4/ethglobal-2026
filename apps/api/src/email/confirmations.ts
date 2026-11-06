import { formatUsdc } from "@app/shared";
import type { Hire } from "../db/schema";
import type { Rebook } from "../hiring/follow";
import type { Email, SendEmail } from "./resend";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number, currency: string) =>
  currency === "INR" ? `₹${Math.round(n).toLocaleString("en-IN")}` : `${currency} ${Math.round(n)}`;
const SANDBOX =
  "This is a test booking in a hotel sandbox: no real room was reserved and no money for the stay was taken.";

/** One email in both forms: plain lines, and the same lines as simple HTML. */
function compose(
  to: string,
  subject: string,
  lines: [label: string, value: string][],
  intro: string,
  links: [string, string][],
): Email {
  const text = [
    intro,
    "",
    ...lines.map(([k, v]) => `${k}: ${v}`),
    "",
    ...links.map(([k, u]) => `${k}: ${u}`),
    "",
    SANDBOX,
  ].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#182026;max-width:560px">
<p>${esc(intro)}</p>
<table style="border-collapse:collapse">${lines.map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#5e676f">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`).join("")}</table>
<p>${links.map(([k, u]) => `<a href="${esc(u)}" style="color:#0e5a64">${esc(k)}</a>`).join(" · ")}</p>
<p style="color:#5e676f;font-size:13px">${esc(SANDBOX)}</p>
</div>`;
  return { to, subject, html, text };
}

/**
 * The guest's confirmation emails: when the hotel confirms the booking, and when a watching agent
 * rebooks it cheaper. To the traveller the booking was for (their email is on the hire).
 */
export function confirmations(send: SendEmail, appOrigin: string) {
  const links = (h: Hire): [string, string][] => [
    ...(h.payTx
      ? ([["The agent's fee on Hedera", `https://hashscan.io/testnet/transaction/${h.payTx}`]] as [
          string,
          string,
        ][])
      : []),
    ["Your chat", `${appOrigin}/chat/${h.chatId}`],
  ];
  const first = (h: Hire) => h.guestName?.split(" ")[0] ?? "there";

  return {
    booked: async (h: Hire, ref: string) =>
      h.guestEmail
        ? send(
            compose(
              h.guestEmail,
              `Booked: ${h.title} (ref ${ref})`,
              [
                ["Stay", h.title],
                ["Booking reference", ref],
                ["Guest", h.guestName ?? ""],
                ["Booked by", `${h.agentName}, through AgentNet`],
                ["Agent's fee", `${formatUsdc(h.feeUnits)} USDC, paid only now it's done`],
              ],
              `Hi ${first(h)}, your stay is booked.`,
              links(h),
            ),
          )
        : false,

    rebooked: async (h: Hire, r: Rebook) =>
      h.guestEmail
        ? send(
            compose(
              h.guestEmail,
              `Cheaper: ${h.title} rebooked (new ref ${r.toBookingId})`,
              [
                ["Stay", h.title],
                ["New booking reference", r.toBookingId],
                ["Price", `${money(r.from, r.currency)} → ${money(r.to, r.currency)}`],
                ["Back to you", money(r.saved, r.currency)],
                ["Guest", h.guestName ?? ""],
              ],
              `Hi ${first(h)}, ${h.agentName} found the same room cheaper and rebooked it.${r.simulated ? " (The price drop was simulated for the demo.)" : ""}`,
              links(h),
            ),
          )
        : false,
  };
}

export type Confirmations = ReturnType<typeof confirmations>;
