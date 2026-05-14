import * as ed25519 from "@noble/ed25519";
import bs58 from "bs58";

// @noble/ed25519 v3 bundles SHA-512 internally, so no etc.sha512Sync
// setter is needed (that was a v2 requirement).

// Pacifica's canonical-JSON signing recipe (per pacifica-fi/python-sdk
// common/utils.py): recursively sort all object keys alphabetically,
// then JSON.stringify with compact separators (",", ":").

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k]);
  return out;
}

export function canonicalize(obj: unknown): string {
  // JSON.stringify with no replacer/indent already uses compact
  // separators (",", ":"). The two .replace calls are defensive belt-
  // and-braces in case future runtimes default to padded separators.
  return JSON.stringify(sortKeys(obj), null, 0)
    .replace(/, /g, ",")
    .replace(/: /g, ":");
}

export type SignatureHeader = {
  type: string;                // e.g. "create_market_order", "bind_agent_wallet"
  timestamp: number;           // ms
  expiry_window: number;       // ms, typically 5000
};

export interface SignedMessage<P> {
  message: string;
  signatureB58: string;
  publicKeyB58: string;
  header: SignatureHeader;
  payload: P;
}

// Build the canonical message string Pacifica expects: header fields
// at the top level, payload nested under "data".
export function buildMessage<P>(header: SignatureHeader, payload: P): string {
  const obj = { ...header, data: payload };
  return canonicalize(obj);
}

// Sign with a raw 32-byte Ed25519 secret seed. Returns base58 signature.
export async function signWithSeed(
  message: string,
  secretSeed: Uint8Array,
): Promise<string> {
  if (secretSeed.length !== 32) {
    throw new Error(`Ed25519 seed must be 32 bytes, got ${secretSeed.length}`);
  }
  const sig = await ed25519.signAsync(
    new TextEncoder().encode(message),
    secretSeed,
  );
  return bs58.encode(sig);
}

// Verify a signature (used for self-tests + agent-wallet sanity check).
export async function verifySig(
  message: string,
  signatureB58: string,
  publicKeyB58: string,
): Promise<boolean> {
  const sig = bs58.decode(signatureB58);
  const pub = bs58.decode(publicKeyB58);
  return ed25519.verifyAsync(sig, new TextEncoder().encode(message), pub);
}

// Convenience: full sign with a Solana keypair's secretKey (64 bytes;
// first 32 are the Ed25519 seed).
export async function signSolanaMessage<P>(
  header: SignatureHeader,
  payload: P,
  publicKeyB58: string,
  secretKey64: Uint8Array,
): Promise<SignedMessage<P>> {
  const message = buildMessage(header, payload);
  const seed = secretKey64.subarray(0, 32);
  const signatureB58 = await signWithSeed(message, seed);
  return { message, signatureB58, publicKeyB58, header, payload };
}
