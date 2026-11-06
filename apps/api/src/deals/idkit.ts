import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { z } from "zod";

/**
 * World ID through IDKit: our server signs each request (the key never leaves it), the person
 * proves in World App (or World's simulator, in staging), and we check the proof with World.
 * Off without WORLD_IDKIT_APP_ID, WORLD_IDKIT_RP_ID and WORLD_IDKIT_SIGNING_KEY.
 */
export interface IdkitConfig {
  appId: `app_${string}`;
  rpId: string;
  signingKey: string;
  environment: "production" | "staging" | "sandbox";
  verifyUrl: string; // World's verify API, for this RP
}

export function loadIdkitConfig(env: Record<string, string | undefined> = process.env) {
  const { WORLD_IDKIT_APP_ID: appId, WORLD_IDKIT_RP_ID: rpId, WORLD_IDKIT_SIGNING_KEY: key } = env;
  if (!appId?.startsWith("app_") || !rpId || !key) return null;
  return {
    appId: appId as `app_${string}`,
    rpId,
    signingKey: key.replace(/^0x/, ""),
    // Sandbox (World's "World ID sbx" app) unless set; staging is World's web simulator.
    environment:
      (["production", "staging"] as const).find((e) => e === env.WORLD_IDKIT_ENV) ?? "sandbox",
    verifyUrl: `https://developer.world.org/api/v4/verify/${rpId}`,
  } satisfies IdkitConfig;
}

/** What the browser needs to start a request: our signature over this action. */
export function rpContext(c: IdkitConfig, action: string) {
  const s = signRequest({ action, signingKeyHex: c.signingKey });
  return {
    rp_id: c.rpId,
    nonce: s.nonce,
    created_at: s.createdAt,
    expires_at: s.expiresAt,
    signature: s.sig,
  };
}

const Result = z
  .object({
    protocol_version: z.string(),
    action: z.string().optional(),
    environment: z.string(),
    responses: z
      .array(z.object({ nullifier: z.string(), signal_hash: z.string().optional() }).loose())
      .min(1),
  })
  .loose();

export class ProofError extends Error {}

/**
 * Checks a proof: for this action and environment, bound to this signal (the account, so a
 * proof can't be replayed for someone else), and valid according to World. Returns the
 * nullifier (decimal), the same every time this person proves this action.
 */
export async function verifyProof(
  c: IdkitConfig,
  raw: unknown,
  want: { action: string; signal: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const r = Result.safeParse(raw);
  if (!r.success) throw new ProofError("That isn't a World ID proof.");
  const p = r.data;
  // 4.0 only: a person's 3.0 proof has another nullifier, so taking both lets them claim twice.
  if (p.protocol_version !== "4.0")
    throw new ProofError("Only World ID 4.0 proofs count (one per person).");
  if (p.environment !== c.environment)
    throw new ProofError("A proof from the wrong World ID environment.");
  if (p.action !== undefined && p.action !== want.action)
    throw new ProofError("A proof for another action.");
  const signal = hashSignal(want.signal).toLowerCase();
  const item = p.responses[0];
  if (!item || (item.signal_hash && item.signal_hash.toLowerCase() !== signal))
    throw new ProofError("A proof made for someone else.");
  const res = await fetchImpl(c.verifyUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(raw),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as {
    success?: boolean;
    detail?: string;
  } | null;
  if (!res?.ok || body?.success !== true)
    throw new ProofError(`World didn't accept the proof${body?.detail ? `: ${body.detail}` : ""}.`);
  return BigInt(item.nullifier).toString(); // one canonical form (decimal)
}
