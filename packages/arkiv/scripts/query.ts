// Read Shikigami's public data straight from Arkiv (Rabdi testnet), with no app in between: the
// agents on the market, the latest payment receipts our app wrote, and verified ratings. Each
// record is checked like the app checks it (signed by who it claims to be from). Read-only.
// Run: pnpm arkiv:query   (with ARKIV_ACCESS_KEY set: the public endpoint is rate limited;
// a free key is at https://hub.arkiv.network/access-keys)
import type { Hex } from "viem";
import { arkivReader, type Kind, SCHEMAS } from "../src";
import { decodeRow } from "../src/read";

const OUR_WRITER: Hex = "0x1f6554BBe59172a0317EE59CD001682033059D75";
const r = arkivReader();

async function list<K extends Kind>(kind: K, label: string, show: (x: never) => string, by?: Hex) {
  type Q = {
    createdBy(a: Hex): Q;
    limit(n: number): Q;
    fetch(): Promise<{ entities: never[] }>;
  };
  let q = r
    .select({ $key: true, $creator: true, $expiresAt: true, body: true })
    .from(SCHEMAS[kind] as never) as unknown as Q;
  if (by) q = q.createdBy(by);
  const rows = (await q.limit(50).fetch()).entities
    .map((e) => decodeRow(kind, e, by))
    .filter((x) => x !== null);
  console.log(`\n${label}: ${rows.length}`);
  for (const x of rows.slice(0, 12)) console.log(`  ${show(x.record as never)}`);
}

await list(
  "agent",
  "Agents (each signed its own profile)",
  (a: { name: string; skill: string; endpoint: string }) =>
    `${a.name} · ${a.skill} · ${a.endpoint}`,
);
await list(
  "receipt",
  "Payment receipts (written by our app)",
  (x: { task: string; payTo: string; amountUnits: string; hederaTx: string }) =>
    `${x.task} · ${x.amountUnits} units → ${x.payTo} · https://hashscan.io/testnet/transaction/${x.hederaTx}`,
  OUR_WRITER,
);
await list(
  "rating",
  "Verified ratings (World ID, one per person per agent)",
  (x: { agent: string; score: number }) => `${x.score}★ for ${x.agent}`,
  OUR_WRITER,
);
