import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { authChallenges, passkeys, type User, users } from "../db/schema";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const ES256 = -7; // P-256: what phones and laptops use, and what a wallet contract can check

export class SignInError extends Error {}

/**
 * Why a device's answer was refused, from the WebAuthn library (a wrong origin, no user
 * verification, a used-up challenge…): public facts about the answer, never a key.
 */
const reason = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, 200);

export interface PasskeySite {
  rpID: string; // the site's hostname: a passkey only works on the site that made it
  origin: string; // https://… (or http://localhost while developing)
  name: string; // shown by the device ("Save a passkey for …")
}

/**
 * Sign-in with a passkey (Face ID, a fingerprint, a phone). Web2 analogy: "Sign in with Apple"
 * without an Apple account. The device keeps the private key and signs a one-time challenge;
 * we keep only the public key.
 */
export function passkeyAuth(db: Db, site: PasskeySite) {
  const remember = (challenge: string) =>
    db
      .insert(authChallenges)
      .values({ challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) });
  // Used up in the same statement that checks it, so a signed challenge can't be replayed.
  const useUp = async (challenge: string) =>
    (
      await db
        .update(authChallenges)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(authChallenges.challenge, challenge),
            isNull(authChallenges.usedAt),
            gt(authChallenges.expiresAt, new Date()),
          ),
        )
        .returning({ challenge: authChallenges.challenge })
    ).length > 0;
  const expected = { expectedOrigin: site.origin, expectedRPID: site.rpID };

  return {
    async registrationOptions(name?: string) {
      const label = name?.trim() || `${site.name} ${new Date().toISOString().slice(0, 10)}`;
      const options = await generateRegistrationOptions({
        rpName: site.name,
        rpID: site.rpID,
        userName: label,
        userDisplayName: label,
        attestationType: "none",
        // Required, not "preferred": with "preferred" some passkey apps (password-manager
        // extensions) skip Face ID / PIN, and the wallet only accepts a verified answer anyway.
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        supportedAlgorithmIDs: [ES256],
      });
      await remember(options.challenge);
      return options;
    },

    /** Checks a new passkey's answer to its challenge, then creates its account. */
    async register(response: RegistrationResponseJSON, label: string | null = null): Promise<User> {
      const result = await verifyRegistrationResponse({
        response,
        expectedChallenge: useUp,
        ...expected,
        supportedAlgorithmIDs: [ES256],
      }).catch((err) => {
        throw new SignInError(`passkey not accepted: ${reason(err)}`);
      });
      if (!result.verified) throw new SignInError("passkey not accepted: not verified");
      const c = result.registrationInfo.credential;
      return db.transaction(async (tx) => {
        const [user] = await tx.insert(users).values({ displayName: label }).returning();
        if (!user) throw new Error("could not create the user");
        await tx.insert(passkeys).values({
          id: c.id,
          userId: user.id,
          publicKey: isoBase64URL.fromBuffer(c.publicKey),
          counter: c.counter,
          transports: c.transports ?? null,
          label,
        });
        return user;
      });
    },

    /** Options for signing in: any passkey this site made, picked on the device. */
    async authenticationOptions() {
      const options = await generateAuthenticationOptions({
        rpID: site.rpID,
        userVerification: "required",
      });
      await remember(options.challenge);
      return options;
    },

    /** Checks a sign-in signature and returns its account. */
    async authenticate(response: AuthenticationResponseJSON): Promise<User> {
      const [row] = await db
        .select({ key: passkeys, user: users })
        .from(passkeys)
        .innerJoin(users, eq(users.id, passkeys.userId))
        .where(eq(passkeys.id, response.id))
        .limit(1);
      if (!row) throw new SignInError("this passkey isn't registered here");
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: useUp,
        ...expected,
        credential: {
          id: row.key.id,
          publicKey: isoBase64URL.toBuffer(row.key.publicKey),
          counter: row.key.counter,
          transports: (row.key.transports ?? undefined) as never,
        },
      }).catch((err) => {
        throw new SignInError(`passkey not accepted: ${reason(err)}`);
      });
      if (!result.verified) throw new SignInError("passkey not accepted: not verified");
      await db
        .update(passkeys)
        .set({ counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() })
        .where(eq(passkeys.id, row.key.id));
      return row.user;
    },
  };
}
