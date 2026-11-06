import { formatUsdc } from "@app/shared";
import type { Hire } from "../db/schema";
import type { Rebook } from "../hiring/follow";
import type { Email, SendEmail } from "./resend";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number, currency: string) =>
  currency === "INR" ? `₹${Math.round(n).toLocaleString("en-IN")}` : `${currency} ${Math.round(n)}`;
const SANDBOX =
  "This is a test booking in a travel sandbox: nothing real was reserved and no money for it was taken.";

/** One email in both forms: plain lines, and the same lines as simple HTML. */
function compose(
  to: string,
  subject: string,
  lines: [label: string, value: string][],
  intro: string,
  links: [string, string][],
  footer = SANDBOX,
): Email {
  const text = [
    intro,
    "",
    ...lines.map(([k, v]) => `${k}: ${v}`),
    "",
    ...links.map(([k, u]) => `${k}: ${u}`),
    "",
    footer,
  ].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#182026;max-width:560px">
<p>${esc(intro)}</p>
<table style="border-collapse:collapse">${lines.map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#5e676f">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`).join("")}</table>
<p>${links.map(([k, u]) => `<a href="${esc(u)}" style="color:#0e5a64">${esc(k)}</a>`).join(" · ")}</p>
<p style="color:#5e676f;font-size:13px">${esc(footer)}</p>
</div>`;
  return { to, subject, html, text };
}

/**
 * The emails AgentNet sends. To the traveller a booking was for (their email is on the hire):
 * booked, rebooked cheaper, refunded, cancelled afterwards; and a copy of each to the account's
 * own email when it has one (so the person booking sees it too). Security notices, like an app
 * being connected, go to the account's email.
 */
export function confirmations(
  send: SendEmail,
  appOrigin: string,
  accountEmail: (userId: string) => Promise<string | null> = async () => null,
) {
  const links = (h: Hire): [string, string][] => [
    ...(h.payTx
      ? ([["The agent's fee on Hedera", `https://hashscan.io/testnet/transaction/${h.payTx}`]] as [
          string,
          string,
        ][])
      : []),
    ["Your chat", `${appOrigin}/chat/${h.chatId}`],
    ["Receipt anyone can check", `${appOrigin}/receipts/${h.id}`],
  ];
  const fee = (h: Hire) => `${formatUsdc(h.feeUnits)} USDC`;
  const first = (h: Hire) => h.guestName?.split(" ")[0] ?? "there";

  /** To the guest, and a copy to the account's email if it's someone else's address. */
  const guest = async (h: Hire, subject: string, rows: [string, string][], intro: string) => {
    const mine = await accountEmail(h.userId).catch(() => null);
    const sent = h.guestEmail
      ? await send(compose(h.guestEmail, subject, rows, intro, links(h)))
      : false;
    if (!mine || mine.toLowerCase() === h.guestEmail?.toLowerCase()) return sent;
    const copy = await send(
      compose(
        mine,
        `Copy: ${subject}`,
        rows,
        `A copy for you: this went to ${h.guestName ?? "the traveller"}.`,
        links(h),
      ),
    );
    return sent || copy;
  };

  return {
    /** The agent couldn't book it, or accepted a reported problem: the fee is back. */
    refunded: (h: Hire, why: "not_booked" | "report") =>
      guest(
        h,
        why === "report" ? `Refunded after your report: ${h.title}` : `Not booked: ${h.title}`,
        [
          ["Booking", h.title],
          ["Agent", h.agentName],
          ["Fee", `${fee(h)}, refunded on Hedera`],
          ...(h.note ? ([["What happened", h.note]] as [string, string][]) : []),
        ],
        why === "report"
          ? `Hi ${first(h)}, ${h.agentName} accepted your report: its fee is refunded${h.note?.includes("booking is cancelled") ? " and the booking is cancelled" : ""}.`
          : `Hi ${first(h)}, ${h.agentName} couldn't book it, so it refunded its fee. Nothing was booked.`,
      ),

    /** Cancelled after it was booked: the agent cancelled it with the hotel or airline. */
    cancelled: (h: Hire) =>
      guest(
        h,
        `Cancelled: ${h.title}${h.bookingRef ? ` (ref ${h.bookingRef})` : ""}`,
        [
          ["Booking", h.title],
          ...(h.bookingRef ? ([["Booking reference", h.bookingRef]] as [string, string][]) : []),
          ["Cancelled by", `${h.agentName}, at your request`],
          ["Agent's fee", `${fee(h)}, kept: it booked as promised`],
        ],
        `Hi ${first(h)}, your booking is cancelled.`,
      ),

    /** An app (Claude) was connected to the account: who to tell if it wasn't them. */
    connected: (to: string, name: string, app: string) =>
      send(
        compose(
          to,
          `${app} was connected to your AgentNet account`,
          [
            ["App", app],
            [
              "It can",
              "find agents, get quotes, and hire within the limits you approve with Face ID",
            ],
            [
              "When",
              new Date().toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Asia/Kolkata",
              }),
            ],
          ],
          `Hi ${name}, ${app} can now use AgentNet for you. If this wasn't you, disconnect it in Wallet → Connected apps.`,
          [["Connected apps", `${appOrigin}/wallet`]],
          "AgentNet runs on test networks: nothing real is booked or paid.",
        ),
      ),

    booked: (h: Hire, ref: string) =>
      guest(
        h,
        `Booked: ${h.title} (ref ${ref})`,
        [
          ["Booking", h.title],
          ["Booking reference", ref],
          ["Guest", h.guestName ?? ""],
          ["Booked by", `${h.agentName}, through AgentNet`],
          ["Agent's fee", `${formatUsdc(h.feeUnits)} USDC, paid only now it's done`],
        ],
        `Hi ${first(h)}, it's booked.`,
      ),

    rebooked: (h: Hire, r: Rebook) =>
      guest(
        h,
        `Cheaper: ${h.title} rebooked (new ref ${r.toBookingId})`,
        [
          ["Booking", h.title],
          ["New booking reference", r.toBookingId],
          ["Price", `${money(r.from, r.currency)} → ${money(r.to, r.currency)}`],
          ["Back to you", money(r.saved, r.currency)],
          ["Guest", h.guestName ?? ""],
        ],
        `Hi ${first(h)}, ${h.agentName} found the same room cheaper and rebooked it.${r.simulated ? " (The price drop was simulated for the demo.)" : ""}`,
      ),

    /** "Send a test email": proves this address gets AgentNet's emails. */
    test: (to: string) =>
      compose(
        to,
        "AgentNet: your emails work",
        [["Email", to]],
        "This is a test from AgentNet. Booking emails and account notices will reach you here.",
        [["Your wallet", `${appOrigin}/wallet`]],
        "AgentNet runs on test networks: nothing real is booked or paid.",
      ),
  };
}

export type Confirmations = ReturnType<typeof confirmations>;
