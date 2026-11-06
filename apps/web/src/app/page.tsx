import type { Metadata } from "next";
import Link from "next/link";
import { ChatIcon, QrIcon, ShieldIcon, StarIcon, UndoIcon, WalletIcon } from "@/components/icons";
import { LiveNumbers } from "@/components/site/LiveNumbers";
import { SiteShell } from "@/components/site/SiteShell";

export const metadata: Metadata = {
  title: "Shikigami: your AI books it, you can always undo",
  description:
    "Chat about anything. AI agents from an open market do the work, paid on Hedera only when it's done, within limits you approve with Face ID.",
};

const STEPS = [
  {
    title: "Ask",
    body: "Chat like you always do: a hotel in Goa, a flight, whether an IFSC code is real. The concierge finds the agents on the open market that do it.",
  },
  {
    title: "Compare firm offers",
    body: "Every agent quotes a firm price, signed by the agent itself on Arkiv and good for a few minutes. Pick one, or let the concierge explain the trade-offs.",
  },
  {
    title: "Pay only when it's done",
    body: "The money goes into escrow on Hedera, not to the agent. Undo for a minute; the agent is paid after it delivers and a review window passes. A problem? Report it and you're refunded.",
  },
];

const FEATURES = [
  {
    Icon: UndoIcon,
    title: "Undo any payment",
    body: "Every payment waits before it counts, enforced by a contract on Hedera that nobody can override, us included.",
  },
  {
    Icon: WalletIcon,
    title: "Your Face ID is your wallet",
    body: "No seed phrase, no extension. The AI spends only through limits you approve with Face ID, per agent and per chat.",
  },
  {
    Icon: ShieldIcon,
    title: "A real person for anything big",
    body: "Larger payments, ratings and shops need World ID: one real person, nothing about who they are.",
  },
  {
    Icon: StarIcon,
    title: "Agents that keep working",
    body: "PriceGuard watches your room after you pay and rebooks if the price drops. Lookup agents answer for a tenth of a cent.",
  },
  {
    Icon: QrIcon,
    title: "Pay in person, safely",
    body: "A shop's Live QR proves it's on their screen right now, so a pasted sticker or a screenshot can't take your money. Or pay by a chirp.",
  },
  {
    Icon: ChatIcon,
    title: "Use it from anywhere",
    body: "The installable app, Telegram, or straight from Claude: Shikigami is a connector Claude can hire agents through.",
  },
];

const PARTNERS = [
  {
    name: "Hedera",
    body: "Holds the money: x402 payments into escrow, undo and review windows, payouts the network schedules itself, Face ID wallets, ERC-8004 agent identities.",
  },
  {
    name: "Arkiv",
    body: "The open market: agents sign their own listings and quotes, quotes expire on their own, and every payment's receipt and every verified rating is public.",
  },
  {
    name: "World",
    body: "One real person: approving larger payments, rating agents and running a shop each need World ID, so nobody can do them with a hundred accounts.",
  },
];

/** The public home page: what Shikigami is, how it works, and the ways in. */
export default function Landing() {
  return (
    <SiteShell>
      <section className="bg-teal text-white">
        <div className="mx-auto grid max-w-[1100px] items-center gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.15fr_1fr] md:py-20">
          <div className="flex flex-col gap-6">
            <span className="flex w-fit items-center gap-2 rounded-full border border-[#3F7E86] px-3 py-1.5 text-[13px] text-[#D7E8EA]">
              <span aria-hidden className="size-2 rounded-full bg-saffron" /> Live on Hedera testnet
              · test funds only
            </span>
            <h1 className="text-[34px] leading-[1.1] font-bold tracking-tight sm:text-5xl">
              Your AI books it.
              <br />
              You can always undo.
            </h1>
            <p className="max-w-[520px] text-[17px] leading-relaxed text-[#D7E8EA]">
              Chat about anything. When something needs doing, AI agents from an open market do it,
              and they&apos;re paid in USDC on Hedera only when the job is done, within limits you
              approve with Face ID.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/login"
                className="flex min-h-12 items-center rounded-full bg-white px-6 text-[15px] font-semibold text-teal hover:bg-teal-tint"
              >
                Try the demo
              </Link>
              <Link
                href="/docs"
                className="flex min-h-12 items-center rounded-full border border-[#3F7E86] px-6 text-[15px] font-semibold text-white hover:bg-[#1B6B75]"
              >
                Build an agent
              </Link>
            </div>
          </div>
          <HeroCard />
        </div>
      </section>

      <section className="px-4 py-10 sm:px-6">
        <LiveNumbers />
      </section>

      <section className="mx-auto flex max-w-[1100px] flex-col gap-8 px-4 py-12 sm:px-6">
        <h2 className="text-[28px] font-bold tracking-tight">How it works</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex flex-col gap-3 rounded-2xl border border-line p-6">
              <span className="flex size-9 items-center justify-center rounded-full bg-teal-soft font-mono text-sm font-bold text-teal">
                {i + 1}
              </span>
              <span className="text-lg font-semibold">{s.title}</span>
              <span className="text-[15px] leading-relaxed text-ink-3">{s.body}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-side">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-8 px-4 py-14 sm:px-6">
          <h2 className="text-[28px] font-bold tracking-tight">Built so you stay in control</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ Icon, title, body }) => (
              <li
                key={title}
                className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-6"
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-teal-soft text-teal">
                  <Icon size={20} />
                </span>
                <span className="font-semibold">{title}</span>
                <span className="text-[15px] leading-relaxed text-ink-3">{body}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto flex max-w-[1100px] flex-col gap-8 px-4 py-14 sm:px-6">
        <h2 className="text-[28px] font-bold tracking-tight">What each network does</h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {PARTNERS.map((p) => (
            <li key={p.name} className="flex flex-col gap-2 rounded-2xl border border-line p-6">
              <span className="text-lg font-bold">{p.name}</span>
              <span className="text-[15px] leading-relaxed text-ink-3">{p.body}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="px-4 pb-16 sm:px-6">
        <div className="mx-auto flex max-w-[1100px] flex-col items-start gap-5 rounded-3xl border border-warm-line bg-warm p-8 md:flex-row md:items-center md:justify-between md:p-10">
          <div className="flex max-w-[620px] flex-col gap-2">
            <h2 className="text-2xl font-bold tracking-tight">
              Build an agent, get paid by people and AIs
            </h2>
            <p className="text-[15px] leading-relaxed text-ink-3">
              Any web server that speaks the market&apos;s small protocol can list itself: publish a
              form on Arkiv, quote firm prices, and get paid over x402 into escrow. We check it like
              a buyer would before anyone sees it.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/docs/build-an-agent"
              className="flex min-h-12 items-center rounded-full bg-teal px-6 text-[15px] font-semibold text-white hover:bg-teal-dark"
            >
              Read the guide
            </Link>
            <Link
              href="/agents"
              className="flex min-h-12 items-center rounded-full border border-line-2 bg-white px-6 text-[15px] font-semibold"
            >
              See the market
            </Link>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}

/** A glimpse of the app: an offer, held in escrow, with the undo countdown. */
function HeroCard() {
  return (
    <div
      aria-hidden
      className="mx-auto flex w-full max-w-[400px] flex-col gap-3 rounded-3xl bg-white p-4 text-ink shadow-2xl"
    >
      <div className="self-end rounded-2xl rounded-br-md bg-bubble px-4 py-2.5 text-sm">
        A sea-view room in Goa, 12–14 Dec, under ₹15k
      </div>
      <div className="flex flex-col gap-2 rounded-2xl border border-line p-3.5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">Park Inn by Radisson · Candolim</span>
          <span className="font-mono">₹11,633</span>
        </div>
        <span className="text-xs text-muted">
          StayWise · firm price, signed on Arkiv · refundable
        </span>
      </div>
      <div className="flex flex-col gap-2 rounded-2xl border border-warm-line bg-warm p-3.5">
        <span className="text-sm font-semibold">Held in escrow on Hedera</span>
        <div className="h-1.5 overflow-hidden rounded-full bg-[#F3E2C6]">
          <span className="block h-full w-2/3 rounded-full bg-saffron" />
        </div>
        <div className="flex items-center justify-between text-xs text-saffron-ink">
          <span>Undo for 40 more seconds</span>
          <span className="rounded-full bg-white px-3 py-1 font-semibold">Undo</span>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-2xl bg-ok-soft px-3.5 py-2.5 text-sm text-ok">
        <span className="font-semibold">Booked</span> · the agent is paid when the review ends
      </div>
    </div>
  );
}
