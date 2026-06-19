// lib/flash-v2/session-store.ts
//
// Persistence for Flash v2 session keys. Mirrors lib/wallets/agent.ts (pending
// row → confirm → decrypt-on-use) and reuses its audited AES-256-GCM cipher.
// db-touching wrappers only; the pure isSessionRowActive predicate lives in
// session.ts so it stays unit-testable.
import { Keypair } from "@solana/web3.js";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessionKeys } from "@/lib/db/schema";
import { encryptSeed, decryptSeed, generateAgentKeypair } from "@/lib/wallets/agent";
import { isSessionRowActive, assertSessionReplaceable } from "./session";

export interface SessionKeyRecord {
  userId: string;
  mainPubkey: string;
  sessionPubkey: string;
  sessionTokenPda: string;
  validUntil: Date;
  keypair: Keypair;
}

/** Generate a fresh session signer keypair (pubkey b58 + 32-byte seed). */
export function generateSessionKeypair(): { publicKeyB58: string; seed: Uint8Array } {
  return generateAgentKeypair();
}

/**
 * Insert a generated-but-not-yet-confirmed session (bound_at = null). One
 * session per user. Refuses to overwrite a still-BOUND row (that would orphan
 * the old on-chain session): throws SessionAlreadyBoundError carrying the prior
 * session so the caller revokes it first. An unbound/stale row is replaced.
 */
export async function createPendingSessionKey(p: {
  userId: string;
  mainPubkey: string;
  sessionPubkey: string;
  sessionTokenPda: string;
  seed: Uint8Array;
  validUntil: Date;
}): Promise<void> {
  const [existing] = await db
    .select({
      boundAt: sessionKeys.boundAt,
      sessionPubkey: sessionKeys.sessionPubkey,
      sessionTokenPda: sessionKeys.sessionTokenPda,
    })
    .from(sessionKeys)
    .where(eq(sessionKeys.userId, p.userId))
    .limit(1);
  assertSessionReplaceable(existing);
  const values = {
    userId: p.userId,
    mainPubkey: p.mainPubkey,
    sessionPubkey: p.sessionPubkey,
    sessionSecretEnc: encryptSeed(p.seed),
    sessionTokenPda: p.sessionTokenPda,
    validUntil: p.validUntil,
    boundAt: null,
  };
  await db.insert(sessionKeys).values(values).onConflictDoUpdate({
    target: sessionKeys.userId,
    set: values,
  });
}

/** Stamp bound_at once the createSessionV2 tx confirms. Scoped by
 *  (userId, sessionPubkey) so a stale pubkey can't bind the wrong row. */
export async function markSessionKeyBound(
  userId: string,
  sessionPubkey: string,
): Promise<boolean> {
  const updated = await db
    .update(sessionKeys)
    .set({ boundAt: new Date() })
    .where(and(eq(sessionKeys.userId, userId), eq(sessionKeys.sessionPubkey, sessionPubkey)))
    .returning({ userId: sessionKeys.userId });
  return updated.length > 0;
}

/** The user's active (bound + unexpired) session, decrypted, or null. */
export async function getActiveSessionKey(userId: string): Promise<SessionKeyRecord | null> {
  const [row] = await db.select().from(sessionKeys).where(eq(sessionKeys.userId, userId)).limit(1);
  if (!row || !isSessionRowActive(row, Date.now())) return null;
  return {
    userId: row.userId,
    mainPubkey: row.mainPubkey,
    sessionPubkey: row.sessionPubkey,
    sessionTokenPda: row.sessionTokenPda,
    validUntil: row.validUntil,
    keypair: Keypair.fromSeed(decryptSeed(row.sessionSecretEnc)),
  };
}

/** Remove the user's session row (after an on-chain revoke). */
export async function deleteSessionKey(userId: string): Promise<void> {
  await db.delete(sessionKeys).where(eq(sessionKeys.userId, userId));
}
