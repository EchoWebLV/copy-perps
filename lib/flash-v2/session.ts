// lib/flash-v2/session.ts
//
// MagicBlock session-key v2 support for server-driven Flash v2 trades. A user
// authorizes a short-lived, Flash-magic-trade-scoped session signer once; the
// server then signs trade txs with the session keypair (no per-order popup) and
// submits them to the Ephemeral Rollup. Surface authority:
// docs/superpowers/flash-v2-session-surface-notes.md.
import { PublicKey } from "@solana/web3.js";
import {
  KEYSP_PROGRAM_ID,
  SESSION_TOKEN_V2_SEED,
  resolveProgramId,
  FLASH_V2_CLUSTER,
} from "./constants";
import { FlashV2Error } from "./errors";

const KEYSP = new PublicKey(KEYSP_PROGRAM_ID);

/**
 * Derive the SessionTokenV2 PDA. Seed order is load-bearing and pinned from the
 * on-chain gpl_session program: ["session_token_v2", target_program,
 * session_signer, authority] under Keysp (session notes §3).
 */
export function deriveSessionTokenV2(authority: string, sessionSigner: string): PublicKey {
  const target = new PublicKey(resolveProgramId(FLASH_V2_CLUSTER));
  const [pda] = PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode(SESSION_TOKEN_V2_SEED),
      target.toBytes(),
      new PublicKey(sessionSigner).toBytes(),
      new PublicKey(authority).toBytes(),
    ],
    KEYSP,
  );
  return pda;
}

/** valid_until is enforced on-chain; expired the instant now reaches it. */
export function isSessionExpired(validUntilSec: number, nowSec: number): boolean {
  return nowSec >= validUntilSec;
}

/** True when the session has <= thresholdSec of life left (refresh trigger). */
export function isSessionExpiringSoon(
  validUntilSec: number,
  nowSec: number,
  thresholdSec: number,
): boolean {
  return validUntilSec - nowSec <= thresholdSec;
}

/**
 * Reject a malformed or mismatched session BEFORE building a trade. The Flash
 * API silently falls back to owner-signing on a bad session and fails later
 * on-chain with no API error (session notes §8.1), so callers must validate.
 */
export function validateSessionConfig(a: {
  owner: string;
  signer: string;
  sessionToken: string;
}): void {
  let derived: string;
  try {
    new PublicKey(a.signer);
    derived = deriveSessionTokenV2(a.owner, a.signer).toBase58();
  } catch {
    throw new FlashV2Error("invalid session signer pubkey", "unknown");
  }
  if (a.sessionToken !== derived) {
    throw new FlashV2Error("session token does not match owner+signer derivation", "unknown");
  }
}
