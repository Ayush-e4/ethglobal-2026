import {
  type Agent,
  type ArkivReader,
  findAgents,
  findListings,
  type Listing,
  publishAgent,
  publishListings,
  type SafeArkivWriter,
} from "@app/arkiv";

/**
 * An agent's place on the market, kept current: its profile is published again when it has
 * moved (a new public address or Hedera account, e.g. a deploy), its listing when what it says
 * changed. Otherwise nothing is written: the newest of each per agent is what counts.
 * Returns whether it was listed before.
 */
export async function keepListed(
  d: { arkiv: SafeArkivWriter; reader: ArkivReader },
  profile: Agent,
  listing: Listing,
) {
  const mine = (r: { creator: string }) => r.creator.toLowerCase() === profile.agent.toLowerCase();
  const newestOf = <T extends { expiresAt: bigint }>(rows: T[]) =>
    [...rows].sort((a, b) => Number(b.expiresAt - a.expiresAt))[0];
  const current = newestOf((await findAgents(d.reader, profile.skill)).filter(mine));
  const moved =
    current?.record.endpoint !== profile.endpoint ||
    current?.record.hederaAccount !== profile.hederaAccount;
  if (!current || moved) {
    await publishAgent(d.arkiv, profile, [listing]);
    return !!current;
  }
  const newest = newestOf((await findListings(d.reader, profile.skill)).filter(mine));
  // Both as the parser returns them (it orders keys), so an unchanged listing isn't republished.
  if (JSON.stringify(newest?.record) !== JSON.stringify(listing))
    await publishListings(d.arkiv, [listing]);
  return true;
}
