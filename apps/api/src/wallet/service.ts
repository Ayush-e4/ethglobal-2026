import type { PasskeyKey } from "@app/mandates";
import { decodeCredentialPublicKey, isoBase64URL } from "@simplewebauthn/server/helpers";
import { and, asc, count, eq, gte, isNotNull } from "drizzle-orm";
import type { Address, Hex } from "viem";
import type { Db } from "../db/client";
import { passkeys, users, wallets } from "../db/schema";
import type { WalletChain } from "./chain";

const STALE_MS = 2 * 60_000; // a wallet still "creating" this long was cut off (a restart)

/** A passkey's public key (stored as COSE) the way the wallet contract wants it: x and y. */
export function passkeyKey(coseB64url: string): PasskeyKey {
  const cose = decodeCredentialPublicKey(isoBase64URL.toBuffer(coseB64url)) as Map<number, unknown>;
  const hex = (b: unknown) => `0x${Buffer.from(b as Uint8Array).toString("hex")}` as Hex;
  if (cose.get(3) !== -7) throw new Error("not a P-256 passkey");
  return { qx: hex(cose.get(-2)), qy: hex(cose.get(-3)) };
}

export interface WalletOptions {
  giftUnits: bigint; // test USDC for a new wallet (0 = none)
  giftsPerDay: number; // across everyone, so making accounts can't drain the sponsor
  log?: (line: string) => void;
}

/**
 * Passkey accounts' own Face ID wallets. Made after sign-up: the sponsor pays the gas and sends
 * a little test USDC (once, at most `giftsPerDay` a day). Making one is safe to repeat: the
 * address comes from the passkey, the factory makes it only once, and the gift is recorded
 * before it's sent, so it never goes out twice.
 */
export function walletService(db: Db, chain: WalletChain, opts: WalletOptions) {
  const making = new Map<string, Promise<void>>();
  const log = opts.log ?? ((line: string) => console.error(line));

  const row = async (userId: string) =>
    (await db.select().from(wallets).where(eq(wallets.userId, userId)))[0] ?? null;

  async function giftAllowed() {
    if (opts.giftUnits <= BigInt(0)) return false;
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const [r] = await db
      .select({ n: count() })
      .from(wallets)
      .where(and(isNotNull(wallets.giftUnits), gte(wallets.createdAt, since)));
    return (r?.n ?? 0) < opts.giftsPerDay;
  }

  async function make(userId: string) {
    const [key] = await db
      .select()
      .from(passkeys)
      .where(eq(passkeys.userId, userId))
      .orderBy(asc(passkeys.createdAt))
      .limit(1);
    if (!key) return;
    const k = passkeyKey(key.publicKey);
    const address = await chain.addressOf(k);
    await db
      .insert(wallets)
      .values({ userId, address })
      .onConflictDoUpdate({ target: wallets.userId, set: { address, status: "creating" } });
    await db.update(passkeys).set({ onWallet: true }).where(eq(passkeys.id, key.id));
    try {
      await chain.create(k);
      let hederaId: string | null = null;
      for (let i = 0; i < 15 && !hederaId; i++) {
        hederaId = await chain.hederaIdOf(address);
        if (!hederaId) await new Promise((r) => setTimeout(r, 2000));
      }
      await db.update(wallets).set({ hederaId }).where(eq(wallets.userId, userId));
      const before = await row(userId);
      if (before?.giftUnits == null && (await giftAllowed())) {
        await db
          .update(wallets)
          .set({ giftUnits: opts.giftUnits })
          .where(eq(wallets.userId, userId));
        await chain.gift(address, opts.giftUnits).catch((err) => {
          log(`wallet gift for ${userId} failed: ${String(err).slice(0, 160)}`);
        });
      }
      await db.update(wallets).set({ status: "ready" }).where(eq(wallets.userId, userId));
    } catch (err) {
      log(`wallet for ${userId} failed: ${String(err).slice(0, 160)}`);
      await db.update(wallets).set({ status: "failed" }).where(eq(wallets.userId, userId));
    }
  }

  return {
    /** The user's wallet with its USDC, or null (a demo account, or no passkey yet). */
    async get(userId: string, withBalance = true) {
      const w = await row(userId);
      if (!w) return null;
      const balance =
        withBalance && w.status === "ready"
          ? await chain.balanceOf(w.address as Address).catch(() => null)
          : null;
      return {
        address: w.address,
        hederaId: w.hederaId,
        status: w.status,
        usdcUnits: balance?.toString() ?? null,
        giftUnits: w.giftUnits?.toString() ?? null,
      };
    },

    /**
     * Makes the wallet if it isn't made: none yet, a failed try, or one a restart cut off.
     * Passkey accounts only. Resolves when done; calls at the same time share one try.
     */
    ensure(userId: string): Promise<void> {
      const running = making.get(userId);
      if (running) return running;
      const p = (async () => {
        const [user] = await db.select().from(users).where(eq(users.id, userId));
        if (!user || user.isDemo) return;
        const w = await row(userId);
        const cutOff = w?.status === "creating" && Date.now() - w.createdAt.getTime() > STALE_MS;
        if (!w || w.status === "failed" || cutOff) await make(userId);
      })().finally(() => making.delete(userId));
      making.set(userId, p);
      return p;
    },
  };
}

export type WalletService = ReturnType<typeof walletService>;
