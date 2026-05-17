import { Keypair } from "@solana/web3.js";
import { and, eq, isNotNull } from "drizzle-orm";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { db } from "@/lib/db";
import { agentWallets } from "@/lib/db/schema";

function getMasterKey(): Buffer {
  const b64 = process.env.AGENT_WALLET_ENCRYPTION_KEY;
  if (!b64) {
    throw new Error("AGENT_WALLET_ENCRYPTION_KEY is required for agent wallet custody");
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error(
      `AGENT_WALLET_ENCRYPTION_KEY must decode to exactly 32 bytes, got ${key.length}`,
    );
  }
  return key;
}

// Encrypts the 32-byte Ed25519 seed. Encoding: base64(iv || ciphertext || tag).
function encryptSeed(seed: Uint8Array): string {
  if (seed.length !== 32) throw new Error("seed must be 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getMasterKey(), iv);
  const ct = Buffer.concat([cipher.update(seed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

function decryptSeed(enc: string): Uint8Array {
  const buf = Buffer.from(enc, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", getMasterKey(), iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return new Uint8Array(out);
}

export interface AgentWalletRecord {
  userId: string;
  mainPubkey: string;
  agentPubkey: string;
  // 64-byte Solana secretKey (32-byte seed + 32-byte derived pubkey).
  agentSecretKey: Uint8Array;
}

// Generates a new Ed25519 keypair for an agent wallet. Returns the
// pubkey (base58) and the 32-byte seed (the writable half of secretKey).
export function generateAgentKeypair(): { publicKeyB58: string; seed: Uint8Array } {
  const kp = Keypair.generate();
  return {
    publicKeyB58: kp.publicKey.toBase58(),
    seed: kp.secretKey.subarray(0, 32),
  };
}

// Returns the user's BOUND agent wallet (usable for trading), or null.
// A row whose bound_at is still null — onboarding interrupted before the
// Pacifica bind — is treated as "no wallet" so callers re-onboard it.
export async function getAgentWallet(userId: string): Promise<AgentWalletRecord | null> {
  const [row] = await db
    .select()
    .from(agentWallets)
    .where(and(eq(agentWallets.userId, userId), isNotNull(agentWallets.boundAt)))
    .limit(1);
  if (!row) return null;
  const seed = decryptSeed(row.agentSecretEnc);
  const kp = Keypair.fromSeed(seed);
  return {
    userId: row.userId,
    mainPubkey: row.mainPubkey,
    agentPubkey: row.agentPubkey,
    agentSecretKey: kp.secretKey,
  };
}

// Lightweight lookup (no seed decryption) used by the onboarding planner
// to decide: bound row → done; unbound row → reuse it; nothing → mint one.
export async function getAgentWalletRow(
  userId: string,
): Promise<{ agentPubkey: string; mainPubkey: string; boundAt: Date | null } | null> {
  const [row] = await db
    .select({
      agentPubkey: agentWallets.agentPubkey,
      mainPubkey: agentWallets.mainPubkey,
      boundAt: agentWallets.boundAt,
    })
    .from(agentWallets)
    .where(eq(agentWallets.userId, userId))
    .limit(1);
  return row ?? null;
}

// Inserts a generated-but-not-yet-bound agent wallet (bound_at = null).
// The encrypted seed is persisted up front so a server restart between
// this and the Pacifica bind can never orphan the bind — finalizeAgentBind
// only has to flip bound_at.
export async function createPendingAgentWallet(params: {
  userId: string;
  mainPubkey: string;
  agentPubkey: string;
  seed: Uint8Array;
}): Promise<void> {
  await db.insert(agentWallets).values({
    userId: params.userId,
    mainPubkey: params.mainPubkey,
    agentPubkey: params.agentPubkey,
    agentSecretEnc: encryptSeed(params.seed),
    boundAt: null,
  });
}

// Stamps bound_at once Pacifica acknowledges the bind. Scoped by
// (userId, agentPubkey) so a stale agentPubkey can't bind the wrong row.
// Returns false when no matching pending row exists.
export async function markAgentWalletBound(
  userId: string,
  agentPubkey: string,
): Promise<boolean> {
  const updated = await db
    .update(agentWallets)
    .set({ boundAt: new Date() })
    .where(
      and(
        eq(agentWallets.userId, userId),
        eq(agentWallets.agentPubkey, agentPubkey),
      ),
    )
    .returning({ userId: agentWallets.userId });
  return updated.length > 0;
}
