import { Keypair } from "@solana/web3.js";
import { eq } from "drizzle-orm";
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

export async function getAgentWallet(userId: string): Promise<AgentWalletRecord | null> {
  const [row] = await db
    .select()
    .from(agentWallets)
    .where(eq(agentWallets.userId, userId))
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

export async function persistAgentWallet(params: {
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
  });
}
