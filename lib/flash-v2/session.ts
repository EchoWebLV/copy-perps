// lib/flash-v2/session.ts
//
// MagicBlock session-key v2 support for server-driven Flash v2 trades. A user
// authorizes a short-lived, Flash-magic-trade-scoped session signer once; the
// server then signs trade txs with the session keypair (no per-order popup) and
// submits them to the Ephemeral Rollup. Surface authority:
// docs/superpowers/flash-v2-session-surface-notes.md.
import {
  PublicKey,
  Transaction,
  VersionedTransaction,
  Keypair,
  Connection,
  SystemProgram,
} from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import {
  KEYSP_PROGRAM_ID,
  SESSION_TOKEN_V2_SEED,
  SESSION_TOPUP_LAMPORTS,
  resolveProgramId,
  FLASH_V2_CLUSTER,
} from "./constants";
import { getConnection } from "./rpc";
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
 * Pure: a stored session row is usable iff it is bound (its createSessionV2 tx
 * confirmed) and not yet expired. Kept here (db-free) so it is unit-testable;
 * the db wrappers in session-store.ts apply it.
 */
export function isSessionRowActive(
  row: { boundAt: Date | null; validUntil: Date },
  nowMs: number,
): boolean {
  return row.boundAt !== null && row.validUntil.getTime() > nowMs;
}

/** The lifecycle state of a stored session row, for the standalone toggle UI. */
export type SessionStatusState = "none" | "pending" | "active" | "expired";

/**
 * Pure: classify a stored session row for display. `none` = no row, `pending` =
 * created but its createSessionV2 hasn't confirmed (bound_at null), `active` =
 * bound + unexpired, `expired` = bound but past valid_until. db-free so it stays
 * unit-testable; the store wrapper in session-store.ts applies it.
 */
export function classifySessionStatus(
  row: { boundAt: Date | null; validUntil: Date } | undefined,
  nowMs: number,
): SessionStatusState {
  if (!row) return "none";
  if (row.boundAt === null) return "pending";
  return row.validUntil.getTime() > nowMs ? "active" : "expired";
}

/** Thrown when creating a session would clobber a still-bound one. Carries the
 *  prior session so the caller can build a revoke tx for it first. */
export class SessionAlreadyBoundError extends FlashV2Error {
  constructor(
    readonly priorSessionPubkey: string,
    readonly priorSessionTokenPda: string,
  ) {
    super("a bound session already exists — revoke it before creating a new one", "session_already_bound");
    this.name = "SessionAlreadyBoundError";
  }
}

/**
 * Guard before persisting a new session: refuse to replace a still-USABLE
 * (bound AND unexpired) row. Overwriting that would orphan a live on-chain
 * session (lost secret, locked rent, a dangling Flash-scoped signer with no
 * revoke path). An unbound (created-but-unconfirmed) row OR an expired bound row
 * is safe to overwrite — an expired session can no longer sign (TTL enforced
 * on-chain), so re-enabling over it is fine (its rent stays locked until the
 * user revokes from the session toggle). Pure / db-free.
 */
export function assertSessionReplaceable(
  existing:
    | { boundAt: Date | null; validUntil: Date; sessionPubkey: string; sessionTokenPda: string }
    | undefined,
  nowMs: number,
): void {
  if (
    existing &&
    existing.boundAt !== null &&
    existing.validUntil.getTime() > nowMs
  ) {
    throw new SessionAlreadyBoundError(existing.sessionPubkey, existing.sessionTokenPda);
  }
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

/** Anchor needs a Wallet to build; for a server-built tx we never sign with it
 *  (the user's Privy wallet signs authority+feePayer later), so signing is a
 *  no-op identity. */
function buildOnlyWallet(publicKey: PublicKey) {
  return {
    publicKey,
    signTransaction: async <T>(t: T) => t,
    signAllTransactions: async <T>(t: T[]) => t,
  };
}

const TARGET_PROGRAM = () => new PublicKey(resolveProgramId(FLASH_V2_CLUSTER));

/**
 * Build the on-chain createSessionV2 tx (base chain). The server generates the
 * session keypair and partial-signs as the session signer here; the user's
 * wallet signs the authority + feePayer slots afterward. Returns the legacy
 * Transaction and the derived SessionTokenV2 PDA (base58).
 */
export async function buildCreateSessionTx(p: {
  authority: string;
  sessionSigner: Keypair;
  validUntilSec: number;
  connection: Connection;
}): Promise<{ tx: Transaction; sessionToken: string }> {
  const authority = new PublicKey(p.authority);
  const sessionTokenPda = deriveSessionTokenV2(
    p.authority,
    p.sessionSigner.publicKey.toBase58(),
  );
  const manager = new SessionTokenManager(buildOnlyWallet(authority) as never, p.connection);
  const tx: Transaction = await manager.program.methods
    .createSessionV2(true, new BN(p.validUntilSec), new BN(SESSION_TOPUP_LAMPORTS))
    .accountsPartial({
      sessionToken: sessionTokenPda,
      sessionSigner: p.sessionSigner.publicKey,
      feePayer: authority,
      authority,
      targetProgram: TARGET_PROGRAM(),
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  tx.feePayer = authority;
  tx.recentBlockhash = (await p.connection.getLatestBlockhash("confirmed")).blockhash;
  // Ephemeral session key co-signs its own creation (session_signer is a signer).
  tx.partialSign(p.sessionSigner);
  return { tx, sessionToken: sessionTokenPda.toBase58() };
}

/**
 * Build the revokeSessionV2 tx (base chain). Refund (close) goes to feePayer =
 * authority; while the session is still active the program requires `authority`
 * to sign, so the user's wallet signs this. Refresh = revoke + re-create.
 */
export async function buildRevokeSessionTx(p: {
  authority: string;
  sessionSigner: string;
  connection: Connection;
}): Promise<Transaction> {
  const authority = new PublicKey(p.authority);
  const sessionTokenPda = deriveSessionTokenV2(p.authority, p.sessionSigner);
  const manager = new SessionTokenManager(buildOnlyWallet(authority) as never, p.connection);
  const tx: Transaction = await manager.program.methods
    .revokeSessionV2()
    .accountsPartial({
      sessionToken: sessionTokenPda,
      feePayer: authority,
      authority,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  tx.feePayer = authority;
  tx.recentBlockhash = (await p.connection.getLatestBlockhash("confirmed")).blockhash;
  return tx;
}

/**
 * Sign a Flash-returned trade tx with the session keypair (no user popup). The
 * tx arrives partially signed by Flash's ER validator with its own blockhash —
 * we add ONLY the session signature and never touch the blockhash (notes §5).
 */
export function signTradeWithSession(
  tx: VersionedTransaction,
  sessionSecretKey: Uint8Array,
): VersionedTransaction {
  tx.sign([Keypair.fromSecretKey(sessionSecretKey)]);
  return tx;
}

/** Submit a session-signed trade to the Ephemeral Rollup (trades → ER only). */
export async function submitErTx(tx: VersionedTransaction): Promise<string> {
  return getConnection("er").sendRawTransaction(tx.serialize(), { skipPreflight: true });
}
