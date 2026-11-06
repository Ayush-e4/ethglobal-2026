/** A deal drop: a scarce benefit, one per person, proven with World ID (IDKit). */
export interface Drop {
  id: string;
  title: string;
  detail: string;
  total: number; // claims available
  maxFeeUnits: bigint; // the most of a fee it pays back
  endsAt: Date;
}

/** World ID's action for a drop: the nullifier is one per person per action. */
export const dropAction = (d: Drop) => `deal-${d.id}`;

/** The drops on offer. */
export const DROPS: Drop[] = [
  {
    id: "fee-back-1",
    title: "Your next agent fee, on us",
    detail:
      "AgentNet pays back the agent's fee for your next booking (up to 0.05 USDC), once the agent is paid.",
    total: 20,
    maxFeeUnits: 50_000n,
    endsAt: new Date("2026-11-10T00:00:00+05:30"),
  },
];
