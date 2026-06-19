# Flash v2 Migration — Phase 2: Session Keys (server-driven copy signing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or
> superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the MagicBlock session-key foundation that lets the server sign Flash v2 trades on a
user's behalf (no per-order popup), replacing Pacifica's bound agent wallet — as a tested library +
storage + venue integration + devnet smoke, all additive and behind `FEATURE_FLASH_V2`.

**Architecture:** A user authorizes a short-lived, Flash-magic-trade-scoped **session signer**
(`SessionTokenV2` PDA under the Keysp program). The server generates the session keypair, holds its
secret encrypted at rest (reusing `lib/wallets/agent.ts` crypto), builds the on-chain
`createSessionV2` tx for the user's wallet to sign (base chain), and thereafter signs trade txs with
the session keypair and submits them to the Ephemeral Rollup. Session creation/revoke = base chain;
trades = ER. This phase is **library + server plumbing + smoke only** — no route rewiring, no
frontend Privy wiring, no Pacifica deletion (those are Phase 3/4). Pacifica execution is untouched.

**Tech Stack:** TypeScript strict, `@solana/web3.js` v1, `@magicblock-labs/gum-sdk@^3.0.10` +
`@coral-xyz/anchor@^0.30.1` (session instruction builder), Drizzle, Vitest. Surface authority:
[../flash-v2-session-surface-notes.md](../flash-v2-session-surface-notes.md) (all facts pinned from
the on-chain `gpl_session` program + IDL + Flash's `examples-v2/tap-trade` reference).

**Key decisions:**
- **Server generates + custodies the session secret** (mirrors the agent-wallet trust posture);
  the secret never reaches the client. The client only signs the createSessionV2 tx with the Privy
  wallet (as `authority` + `feePayer`).
- **Reuse `AGENT_WALLET_ENCRYPTION_KEY`** for the session secret (same trust boundary; avoids new
  env). Reuse `encryptSeed`/`decryptSeed` (export them from `agent.ts`).
- **Use the gum-sdk** to build `createSessionV2`/`revokeSessionV2` (matches Flash's proven
  reference; hand-rolling the Anchor discriminator + Borsh `Option` encoding is more error-prone and
  a wrong instruction = an invisible session). Task 1 verifies the deps install + build cleanly; a
  dependency conflict is a BLOCKED escalation, with manual IDL encoding as the documented fallback.
- **Short TTL** (default 12h, hard cap 7d enforced on-chain). Refresh = revoke + re-create.

---

## File Structure

```
lib/flash-v2/
  constants.ts        # MODIFY: + KEYSP_PROGRAM_ID, SESSION_TOKEN_V2_SEED, TTL + topup consts
  session.ts          # CREATE: PDA derive, validation, expiry, build create/revoke, sign-trade
  session.test.ts     # CREATE
  session-store.ts    # CREATE: keypair gen + sessionKeys CRUD (db) + pure isSessionRowActive
  session-store.test.ts # CREATE (pure predicate only; db wrappers are typecheck-only)
  venue.ts            # MODIFY: open/close accept optional { session }
  venue.test.ts       # MODIFY: session-present cases
lib/wallets/agent.ts  # MODIFY: export encryptSeed, decryptSeed (additive)
lib/db/schema.ts      # MODIFY: + sessionKeys table
scripts/flash-v2/
  smoke-session.ts    # CREATE: devnet create→open→close→revoke via session
package.json          # MODIFY: + gum-sdk, anchor
docs/superpowers/flash-v2-session-surface-notes.md  # DONE (committed with this plan)
```

---

### Task 1: Dependencies + session constants

**Files:** Modify `package.json`, `lib/flash-v2/constants.ts`; Test `lib/flash-v2/constants.test.ts`.

- [ ] **Step 1** — Add deps: `npm install @magicblock-labs/gum-sdk@^3.0.10 @coral-xyz/anchor@^0.30.1`.
- [ ] **Step 2** — Immediately verify no dependency conflict: `npm run build` (or `npx tsc --noEmit`). If it fails on a peer/anchor conflict, STOP (BLOCKED) — fallback is manual IDL instruction encoding (see surface notes §4); do not paper over with `--force`.
- [ ] **Step 3** — Add to `constants.ts`:

```ts
/** MagicBlock session-keys program (Keysp); same on mainnet + devnet. */
export const KEYSP_PROGRAM_ID = "KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5";
/** SessionTokenV2 PDA seed prefix — the "_v2" is load-bearing (surface notes §3). */
export const SESSION_TOKEN_V2_SEED = "session_token_v2";
/** Program hard-rejects valid_until beyond now + 7d (ValidityTooLong). */
export const MAX_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Default session lifetime — short on purpose (server custodies the secret). */
export const DEFAULT_SESSION_TTL_SECONDS = 12 * 60 * 60;
/** One-time rent top-up for the session token (refunded on revoke). */
export const SESSION_TOPUP_LAMPORTS = Math.round(0.01 * 1e9);
```

- [ ] **Step 4** — Test: `DEFAULT_SESSION_TTL_SECONDS < MAX_SESSION_TTL_SECONDS`; `KEYSP_PROGRAM_ID` and `SESSION_TOKEN_V2_SEED === "session_token_v2"`; `SESSION_TOPUP_LAMPORTS === 10_000_000`.
- [ ] **Step 5** — `npx vitest run lib/flash-v2/constants` → PASS. Commit.

### Task 2: PDA derivation + validation + expiry (pure)

**Files:** Create `lib/flash-v2/session.ts`, `lib/flash-v2/session.test.ts`.

- [ ] **Step 1 (test first)** — assert: `deriveSessionTokenV2(authority, sessionSigner)` is deterministic and on the curve under `KEYSP_PROGRAM_ID`; `isSessionExpired(validUntil, now)` true iff `now >= validUntil`; `isSessionExpiringSoon(validUntil, now, threshold)` true iff `validUntil - now <= threshold`; `validateSessionConfig({ owner, signer, sessionToken })` throws `FlashV2Error` when `signer`/`sessionToken` aren't base58 pubkeys or when `sessionToken !== deriveSessionTokenV2(owner, signer)` (no silent fallback — surface notes §8.1).
- [ ] **Step 2** — Implement in `session.ts`:

```ts
import { PublicKey } from "@solana/web3.js";
import { KEYSP_PROGRAM_ID, SESSION_TOKEN_V2_SEED, resolveProgramId, FLASH_V2_CLUSTER } from "./constants";
import { FlashV2Error } from "./errors";

const KEYSP = new PublicKey(KEYSP_PROGRAM_ID);

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

export function isSessionExpired(validUntilSec: number, nowSec: number): boolean {
  return nowSec >= validUntilSec;
}
export function isSessionExpiringSoon(validUntilSec: number, nowSec: number, thresholdSec: number): boolean {
  return validUntilSec - nowSec <= thresholdSec;
}

/** Reject a bad session BEFORE building a trade (silent-fallback gotcha). */
export function validateSessionConfig(a: { owner: string; signer: string; sessionToken: string }): void {
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
```

- [ ] **Step 3** — `npx vitest run lib/flash-v2/session` → PASS. Commit.

### Task 3: Build createSessionV2 / revokeSessionV2 (server-built, session-co-signed)

**Files:** Modify `lib/flash-v2/session.ts`, `lib/flash-v2/session.test.ts`.

- [ ] **Step 1 (test first)** — `buildCreateSessionTx({ authority, sessionSigner, validUntil, connection })` returns `{ tx, sessionToken }` where `tx` is a legacy `Transaction` whose first instruction targets `KEYSP_PROGRAM_ID`, includes the derived PDA, and marks `sessionSigner`+`authority` as signers; `sessionToken` equals the derived PDA. Mock `connection.getLatestBlockhash`. (We assert the SDK-built instruction's programId + account metas, not signatures.)
- [ ] **Step 2** — Implement using gum-sdk with a build-only stub wallet:

```ts
import { Transaction, Keypair, Connection } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import { SESSION_TOPUP_LAMPORTS } from "./constants";

function stubWallet(publicKey: PublicKey) {
  return { publicKey, signTransaction: async (t: Transaction) => t, signAllTransactions: async (t: Transaction[]) => t };
}

export async function buildCreateSessionTx(p: {
  authority: string; sessionSigner: Keypair; validUntilSec: number; connection: Connection;
}): Promise<{ tx: Transaction; sessionToken: string }> {
  const authority = new PublicKey(p.authority);
  const sessionToken = deriveSessionTokenV2(p.authority, p.sessionSigner.publicKey.toBase58());
  const manager = new SessionTokenManager(stubWallet(authority) as never, p.connection);
  const tx: Transaction = await manager.program.methods
    .createSessionV2(true, new BN(p.validUntilSec), new BN(SESSION_TOPUP_LAMPORTS))
    .accountsPartial({
      sessionToken, sessionSigner: p.sessionSigner.publicKey,
      feePayer: authority, authority, targetProgram: new PublicKey(resolveProgramId(FLASH_V2_CLUSTER)),
    })
    .transaction();
  tx.feePayer = authority;
  tx.recentBlockhash = (await p.connection.getLatestBlockhash("confirmed")).blockhash;
  tx.partialSign(p.sessionSigner); // ephemeral key co-signs; user wallet signs later
  return { tx, sessionToken: sessionToken.toBase58() };
}
// buildRevokeSessionTx: same manager, .revokeSessionV2().accountsPartial({ sessionToken, feePayer: authority, authority }).transaction()
```

- [ ] **Step 3** — `npx vitest run lib/flash-v2/session` → PASS. Commit.

### Task 4: Session keypair storage (`sessionKeys` table + store)

**Files:** Modify `lib/wallets/agent.ts` (export crypto), `lib/db/schema.ts`; Create `lib/flash-v2/session-store.ts`, `lib/flash-v2/session-store.test.ts`.

- [ ] **Step 1** — In `agent.ts`, add `export` to `encryptSeed` and `decryptSeed` (additive only).
- [ ] **Step 2** — Add `sessionKeys` table to `schema.ts` (mirror `agentWallets`, + session fields):

```ts
export const sessionKeys = pgTable("session_keys", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  mainPubkey: text("main_pubkey").notNull(),
  sessionPubkey: text("session_pubkey").notNull().unique(),
  sessionSecretEnc: text("session_secret_enc").notNull(), // AES-256-GCM, AGENT_WALLET_ENCRYPTION_KEY
  sessionTokenPda: text("session_token_pda").notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  boundAt: timestamp("bound_at", { withTimezone: true }), // null = created-not-yet-confirmed
});
```

- [ ] **Step 3** — `session-store.ts`: `generateSessionKeypair()` (reuse `generateAgentKeypair`), pure `isSessionRowActive(row, nowSec)` (`boundAt != null && validUntil > now`), and db wrappers `createPendingSessionKey`, `getActiveSessionKey(userId)` (filter active → `decryptSeed` → `Keypair.fromSeed` → `{ keypair, sessionToken, validUntil }`), `markSessionKeyBound`, `deleteSessionKey`.
- [ ] **Step 4 (test)** — Unit-test the PURE `isSessionRowActive` (bound+future = true; unbound = false; expired = false). DB wrappers are typecheck-only (repo convention — `agent.ts` db fns are untested).
- [ ] **Step 5** — `npx vitest run lib/flash-v2/session-store` → PASS; `npx tsc --noEmit | grep flash-v2` empty. Commit. (Note: `npm run db:push` to create the table is a USER-run deploy step, not done here.)

### Task 5: Server-side trade signing + ER submit

**Files:** Modify `lib/flash-v2/session.ts`, `lib/flash-v2/session.test.ts`.

- [ ] **Step 1 (test)** — `signTradeWithSession(tx, secretKey)` calls `tx.sign([Keypair.fromSecretKey(secretKey)])` (spy) and returns `tx`; `submitErTx(tx)` uses `getConnection("er")` (mock) `sendRawTransaction` with `skipPreflight:true` and returns the sig.
- [ ] **Step 2** — Implement:

```ts
import { VersionedTransaction } from "@solana/web3.js";
import { getConnection } from "./rpc";

export function signTradeWithSession(tx: VersionedTransaction, sessionSecretKey: Uint8Array): VersionedTransaction {
  tx.sign([Keypair.fromSecretKey(sessionSecretKey)]); // never touch the blockhash (surface notes §5)
  return tx;
}
export async function submitErTx(tx: VersionedTransaction): Promise<string> {
  return getConnection("er").sendRawTransaction(tx.serialize(), { skipPreflight: true });
}
```

- [ ] **Step 3** — `npx vitest run lib/flash-v2/session` → PASS. Commit.

### Task 6: Venue extension — optional session on open/close

**Files:** Modify `lib/flash-v2/venue.ts`, `lib/flash-v2/venue.test.ts`.

- [ ] **Step 1 (test)** — `openPosition`/`closePosition` with `session: { signer, sessionToken }` add `signer` + `sessionToken` to the builder body AND call `validateSessionConfig({ owner, signer, sessionToken })` (mismatched token → throws, no request sent); without `session`, the body is unchanged (existing tests stay green).
- [ ] **Step 2** — Add `session?: { signer: string; sessionToken: string }` to `OpenArgs`/`CloseArgs`; in each method, if `args.session`, call `validateSessionConfig({ owner: args.owner, ...args.session })` then set `body.signer`/`body.sessionToken`.
- [ ] **Step 3** — `npx vitest run lib/flash-v2/venue` → PASS. Commit.

### Task 7: Devnet session smoke script

**Files:** Create `scripts/flash-v2/smoke-session.ts`.

- [ ] **Step 1** — With a funded devnet keypair as `authority`: generate a session keypair → `buildCreateSessionTx` → user-sign (authority) + already session-co-signed → submit BASE → confirm → read back `manager.get(pda)` (assert exists) → `venue.openPosition({ ..., session })` → `signTradeWithSession` → `submitErTx` → `getPositions` → `venue.closePosition({ ..., session })` → sign+submit → `buildRevokeSessionTx` → submit BASE. Loud warnings when a leg returns empty (mirror `smoke-lifecycle.ts`). Header: "devnet only; do NOT run on mainnet."
- [ ] **Step 2** — `npx tsc --noEmit` clean for the script. Commit. (Execution is a USER step — needs a funded devnet wallet; it resolves surface notes §9.)

### Task 8: Phase 2 verification

- [ ] **Step 1** — `npx vitest run lib/flash-v2` → all green; full `npx vitest run` shows no NEW failures vs the known pre-existing 3 (arena/llm missing `ai` dep ×2, railway-config drift ×1).
- [ ] **Step 2** — `npx tsc --noEmit | grep flash-v2` empty.
- [ ] **Step 3** — Adversarial review (workflow) of the Phase 2 diff vs this plan + the surface notes; fix confirmed findings; re-verify. Commit.

---

## Self-Review

- **Spec coverage:** Implements spec §9 (session keys) + the server-signing half of §10's copy path foundation; defers route rewiring (§10) and frontend Privy wiring to Phase 3, Pacifica deletion to Phase 4 — consistent with §13 phasing and "delete Pacifica last."
- **No placeholders:** every code step has concrete code or a concrete reused signature (`generateAgentKeypair`, `encryptSeed`/`decryptSeed`, `getConnection`, `resolveProgramId`).
- **Type consistency:** `deriveSessionTokenV2(authority, sessionSigner)` arg order matches the PDA seed order; `validateSessionConfig` uses the same derivation; `signTradeWithSession`/`submitErTx` operate on `VersionedTransaction`; create/revoke return legacy `Transaction` (base chain) — intentionally distinct from the Flash versioned trade txs.
- **Devnet-gated risk isolated:** the one unproven piece (exact `createSessionV2` account auto-resolution / ER RPC URL) is contained to Task 3 + Task 7's smoke, with the surface notes §9 checklist as the gate before Phase 3 consumes this.
