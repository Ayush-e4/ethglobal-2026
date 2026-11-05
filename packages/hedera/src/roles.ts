/**
 * Every Hedera account we hold a key for has exactly one job. docs/roles.md is the long form;
 * the status script prints this table so the two never drift apart.
 */
export const ROLES = {
  operator: {
    env: "HEDERA",
    job: "Sets things up: creates the other accounts, the public log and (later) deploys contracts",
    cannot: "Write to the public log, or move anyone else's money",
  },
  relayer: {
    env: "RELAYER",
    job: "Pays network fees for transactions other people sign (so users need no HBAR)",
    cannot: "Move anyone's money: it only sends what someone else already signed",
  },
  demoWallet: {
    env: "DEMO_WALLET",
    job: 'Holds test USDC for "Try the demo" accounts and owns their spending limits (with daily caps)',
    cannot: "Pay anyone outside a limit: payments only move through MandateRegistry's rules",
  },
  logWriter: {
    env: "LOG_WRITER",
    job: "Writes entries to the public log (an HCS topic)",
    cannot: "Delete or edit the log (nobody can: the topic has no admin key), or pay anyone",
  },
} as const;

export type Role = keyof typeof ROLES;
