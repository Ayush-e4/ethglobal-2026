import { assertionFromWebAuthn, type WalletCall } from "@app/mandates";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { z } from "zod";
import type { Db } from "../db/client";
import { passkeys, type WalletOpMeta, walletOps, wallets } from "../db/schema";
import type { WalletChain } from "./chain";
import { passkeyKey } from "./service";

const OP_TTL_MS = 5 * 60_000;

/**
 * Gas per kind of move. Hedera charges at least 80% of the limit whatever is used, so each kind
 * gets its own: a limit approves USDC through the token service (1.2M used on testnet); a cancel
 * is one passkey check and one write (0.3M used).
 */
const GAS: Record<WalletOpMeta["kind"], bigint> = {
  limit: BigInt(2_000_000),
  revoke: BigInt(800_000),
};

export class WalletOpError extends Error {}

/** A device's answer to a Face ID approval, as @simplewebauthn/browser returns it. */
export const ApprovalSchema = z.object({
  id: z.string().max(1024),
  response: z.object({
    clientDataJSON: z.string().max(4096),
    authenticatorData: z.string().max(4096),
    signature: z.string().max(512),
  }),
});
export type Approval = z.infer<typeof ApprovalSchema>;

const challengeOf = (digest: string) =>
  isoBase64URL.fromBuffer(new Uint8Array(Buffer.from(digest.slice(2), "hex")));

/**
 * Face ID approvals for a wallet, in two steps. `prepare`: the batch and its digest, which the
 * device signs as a WebAuthn challenge. `run`: the device's answer, checked here (our site, our
 * challenge, one of the wallet's passkeys) and then by the wallet contract itself, which is what
 * actually decides. Each approval works once, for 5 minutes, and survives a restart.
 */
export function walletApprovals(
  db: Db,
  chain: WalletChain,
  site: { rpID: string; origin: string },
) {
  return {
    async prepare(userId: string, calls: WalletCall[], meta: WalletOpMeta) {
      const [w] = await db.select().from(wallets).where(eq(wallets.userId, userId));
      if (w?.status !== "ready") throw new WalletOpError("Your wallet isn't ready yet.");
      const keys = await db
        .select()
        .from(passkeys)
        .where(and(eq(passkeys.userId, userId), eq(passkeys.onWallet, true)));
      if (keys.length === 0) throw new WalletOpError("No passkey can approve for this wallet.");
      const deadline = BigInt(Math.floor((Date.now() + OP_TTL_MS) / 1000));
      const digest = await chain.digest(w.address as Address, calls, deadline);
      const [op] = await db
        .insert(walletOps)
        .values({
          userId,
          wallet: w.address,
          calls: calls.map((c) => ({ to: c.to, value: c.value.toString(), data: c.data })),
          deadline,
          digest,
          meta,
          expiresAt: new Date(Date.now() + OP_TTL_MS),
        })
        .returning();
      if (!op) throw new Error("could not save the approval");
      return {
        opId: op.id,
        options: {
          challenge: challengeOf(digest),
          rpId: site.rpID,
          allowCredentials: keys.map((k) => ({
            id: k.id,
            type: "public-key" as const,
            transports: k.transports ?? [],
          })),
          userVerification: "required" as const,
          timeout: 120_000,
        },
      };
    },

    /** What a prepared approval is for (to check it against the request), without using it. */
    async meta(userId: string, opId: string): Promise<WalletOpMeta | null> {
      const [op] = await db
        .select()
        .from(walletOps)
        .where(
          and(
            eq(walletOps.id, opId),
            eq(walletOps.userId, userId),
            isNull(walletOps.usedAt),
            gt(walletOps.expiresAt, new Date()),
          ),
        );
      return op?.meta ?? null;
    },

    /** The device answered: run the batch on Hedera. One go, even if it fails. */
    async run(userId: string, opId: string, answer: Approval) {
      const [op] = await db
        .update(walletOps)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(walletOps.id, opId),
            eq(walletOps.userId, userId),
            isNull(walletOps.usedAt),
            gt(walletOps.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!op) throw new WalletOpError("That approval expired or was already used. Try again.");
      const [key] = await db
        .select()
        .from(passkeys)
        .where(
          and(eq(passkeys.id, answer.id), eq(passkeys.userId, userId), eq(passkeys.onWallet, true)),
        );
      if (!key) throw new WalletOpError("That passkey can't approve for this wallet.");
      const client = JSON.parse(isoBase64URL.toUTF8String(answer.response.clientDataJSON)) as {
        type?: string;
        origin?: string;
        challenge?: string;
      };
      if (
        client.type !== "webauthn.get" ||
        client.origin !== site.origin ||
        client.challenge !== challengeOf(op.digest)
      )
        throw new WalletOpError("That approval is for something else.");
      const calls = op.calls.map((c) => ({
        to: c.to as Address,
        value: BigInt(c.value),
        data: c.data as Hex,
      }));
      const sig = { ...passkeyKey(key.publicKey), sig: assertionFromWebAuthn(answer.response) };
      const gas = GAS[op.meta.kind];
      const result = await chain.execute(op.wallet as Address, calls, op.deadline, sig, gas);
      return { ...result, wallet: op.wallet as Address, meta: op.meta };
    },
  };
}

export type WalletApprovals = ReturnType<typeof walletApprovals>;
