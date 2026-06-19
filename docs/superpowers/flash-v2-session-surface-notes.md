# Flash v2 Session-Key Surface — confirmed integration surface (Phase 2 Task 0)

Seeds the Phase 2 plan ([2026-06-19-flash-v2-migration-phase-2.md](plans/2026-06-19-flash-v2-migration-phase-2.md)).
Every claim below is tagged **CONFIRMED** (with a source) or **DEVNET-GATED** (the smoke must
resolve it before it is trusted in the UI). Program IDs and the PDA seed layout are pinned from
**primary program source** — the on-chain `gpl_session` program + its published IDL — not from
summaries. Nothing here is invented.

## 1. Why session keys

Server-driven copy trading needs to open a mirror when a followed trader opens and close it when
they exit, with **no per-order user wallet popup**. Pacifica did this with a bound agent wallet
(`lib/pacifica/sign.ts`, `bindAgentWallet`). Flash v2 does it with **MagicBlock session keys v2**:
the user authorizes a short-lived, program-scoped **session signer** once; the server then signs
trade txs with that session key and submits them to the Ephemeral Rollup. Scope (locked to the
Flash magic-trade program) + a hard expiry are the only on-chain guardrails, so sessions are kept
short-lived and revocable.

## 2. Program + package identities — CONFIRMED

| Thing | Value | Source |
|---|---|---|
| Session-keys program (Keysp) | `KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5` (mainnet + devnet) | `magicblock-labs/session-keys` `gpl_session/src/lib.rs`; our own `.agents/skills/magicblock/resources.md:70` |
| Flash magic-trade (scope / target) program | `FTv2RxXarPfNta45HTTMVaGvjzsGg27FXJ3hEKWBhrzV` | Flash v2 design spec §4; reused as `FLASH_V2` program id in `lib/flash-v2/constants.ts` |
| SDK package | `@magicblock-labs/gum-sdk@^3.0.10` (NOT `gum-react-sdk`) | npm registry + tarball `lib/idl/gpl_session.json`, `lib/sessionTokenManager.d.ts`; Flash `examples/tap-trade/package.json` |
| Anchor peer (for `BN`) | `@coral-xyz/anchor` (~0.30.1) | gum-sdk peer dep |

`SessionTokenManager` is the export: `new SessionTokenManager(wallet, connection)` exposes
`.program` (`anchor.Program`). It does **not** export a PDA-derive helper — derive it yourself (§3).

## 3. `SessionTokenV2` PDA derivation — CONFIRMED-from-program-source

Seeds, in order, raw 32-byte pubkeys (the literal prefix is `"session_token_v2"`; IDL const bytes
`[115,101,115,115,105,111,110,95,116,111,107,101,110,95,118,50]` decode to exactly that string):

```ts
const KEYSP_PROGRAM_ID = new PublicKey("KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5");
const MAGIC_TRADE_PROGRAM = new PublicKey("FTv2RxXarPfNta45HTTMVaGvjzsGg27FXJ3hEKWBhrzV");

const [sessionToken] = PublicKey.findProgramAddressSync(
  [
    new TextEncoder().encode("session_token_v2"), // SessionTokenV2::SEED_PREFIX
    MAGIC_TRADE_PROGRAM.toBytes(),                 // target_program
    sessionSigner.toBytes(),                       // session_signer
    authority.toBytes(),                           // authority = the user's wallet
  ],
  KEYSP_PROGRAM_ID,
);
```

Source: `CreateSessionTokenV2` account context in `gpl_session/src/lib.rs` (master) uses
`seeds = [SessionTokenV2::SEED_PREFIX.as_bytes(), target_program.key(), session_signer.key(), authority.key()]`.
The conflicting v1 derivation (`["session", proxy_wallet, nonce]`) is **wrong** for v2; the `_v2`
suffix is load-bearing — the wrong prefix yields a different PDA and a silently invisible session.

## 4. `createSessionV2` instruction — CONFIRMED (IDL + program context)

Args (all `Option`, in order): `top_up: bool`, `valid_until: i64`, `lamports: u64`.
Accounts, in order: `session_token`(pda, mut), `session_signer`(mut, **signer**),
`fee_payer`(mut, **signer**), `authority`(**signer**), `target_program`, `system_program`.

```ts
import { BN } from "@coral-xyz/anchor";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";

const validUntil = Math.floor(nowSec) + ttlSec; // ttl < 7 days (program rejects beyond: ValidityTooLong)
const manager = new SessionTokenManager(wallet, connection);
const tx = await manager.program.methods
  .createSessionV2(true, new BN(validUntil), new BN(Math.round(0.01 * 1e9)))
  .accountsPartial({
    sessionToken,                           // derived PDA (init) — mut, not signer
    sessionSigner: sessionSigner.publicKey, // mut + signer (ephemeral key co-signs)
    feePayer: authority,                    // mut + signer (pays rent, refunded on revoke)
    authority,                              // signer (the user's wallet)
    targetProgram: MAGIC_TRADE_PROGRAM,
  })
  .transaction();                           // legacy Transaction, base-chain
```

- **Three required signers:** `sessionSigner`, `feePayer`, `authority`. In Flash's flow `feePayer`
  and `authority` are the same wallet, so the wallet provides one signature and the ephemeral
  session key provides the other (`tx.partialSign(sessionSigner)`).
- `top_up: true` + `lamports` move ~0.01 SOL from the wallet to fund the session token's rent;
  refunded to `fee_payer` on revoke. **ER trades are gasless** — the session signer needs no SOL to
  trade; the only SOL cost is this one-time rent at creation.

### Our server-built variant (keeps the session secret server-side)

The server generates the session keypair (secret never leaves the server, encrypted at rest),
builds the createSessionV2 tx with `authority`/`feePayer` = the user's wallet, sets
`feePayer` + a base-chain blockhash, **partial-signs with the session keypair**, and returns the
tx to the client. The client signs with the Privy wallet (covering `authority`+`feePayer`) and
submits to **base chain**. `SessionTokenManager` is constructed with a stub wallet
(`publicKey = userWallet`, identity `signTransaction`) purely to *build* the instruction — no real
wallet signing happens server-side.

## 5. Trade signing + ER submission — CONFIRMED-from-example

Open/close request bodies take two optional fields:

- `signer: string` = the **session signer pubkey**, base58.
- `sessionToken: string` = the **`SessionTokenV2` PDA address**, base58 (NOT a JWT/opaque token).

Omit both → owner-signed tx. Present both → the API bakes the session token into the trade ix and
returns a partially-signed versioned tx for the **session key** to complete:

```ts
// build request: { owner, ...tradeParams, signer, sessionToken }
const tx = VersionedTransaction.deserialize(Buffer.from(transactionBase64, "base64"));
tx.sign([sessionKeypair]);                 // ONLY the session keypair; never touch the blockhash
await erConnection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
```

Trades go to the **ER RPC**; session creation/revoke go to **base chain** (the dual-RPC split
`lib/flash-v2/rpc.ts` already owns). Nothing session-program-specific happens at trade time beyond
passing `signer`+`sessionToken` in the build request.

## 6. Revoke — CONFIRMED

`revokeSessionV2()` with accounts `{ sessionToken, feePayer, authority }`; `close = fee_payer`
receives the rent refund. If the session is **not yet expired**, the handler requires `authority`
to sign; an expired session can be reaped by the session key alone. Refresh = revoke + create new
(there is **no extend instruction**).

## 7. Reuse map (our codebase) — CONFIRMED

| Need | Reuse | `file:line` |
|---|---|---|
| Generate session keypair | `generateAgentKeypair()` (`{ publicKeyB58, seed }`) | `lib/wallets/agent.ts:52-58` |
| Encrypt secret at rest (AES-256-GCM) | `encryptSeed()` | `lib/wallets/agent.ts:21-29` |
| Decrypt | `decryptSeed()` | `lib/wallets/agent.ts:31-40` |
| Master key | `getMasterKey()` ← `AGENT_WALLET_ENCRYPTION_KEY` | `lib/wallets/agent.ts:7-18` |
| Pending-then-bind storage pattern | `agentWallets` table + `createPendingAgentWallet()`/`getAgentWallet()` | `lib/db/schema.ts:103-121`, `lib/wallets/agent.ts:101-114,63-78` |
| User-authorizes-bind route shape | agent bind route | `app/api/users/me/agent/bind/route.ts:44-81` |
| Auto-close sweep loop shape | `runMirrorCloseSweep()` | `lib/bets/mirror-close.ts:183-227` |

Phase 2 **reuses `lib/wallets/agent.ts` crypto by importing it** (it lives under `lib/wallets/`, not
Pacifica) and adds a new `sessionKeys` table — it does **not** modify any Pacifica execution code.
Pre-existing tech debt: `decryptSeed` is duplicated in `lib/bets/mirror-close.ts:33-46`; out of
scope here (flag separately), do not refactor live Pacifica paths in this phase.

## 8. Gotchas (each handled in `lib/flash-v2/session.ts`)

1. **Silent fallback on invalid session pubkey** — a malformed `signer`/`sessionToken` builds an
   owner-signed tx that fails later on-chain, with no API error. **Validate both base58 pubkeys
   (and the derived PDA) before sending** — never let a bad session silently degrade.
2. **Wrong seed prefix = invisible session** — must be `"session_token_v2"`.
3. **Hard, non-extendable expiry** — `valid_until` is enforced on-chain; a session can expire
   mid-experiment and silently break the auto-close sweep. Track `validUntil`; flag expiring-soon
   and re-bind proactively.
4. **Dual-RPC** — creation/revoke on base chain; trades on ER. Reuse `rpc.ts`.
5. **Don't touch the blockhash** on Flash-returned trade txs (they arrive partially signed).
6. **Server custody** — the server holds the session secret; scope + short expiry are the only
   guardrails. Keep TTL short (hours, not the 7-day max).

## 9. Devnet validation (2026-06-19) + remaining mainnet-gated items

**Validated on-chain (devnet, wallet `AW3jPeBDkyRWB3mSV6QmbWyBZqyeVNhCHWCuefMrdQGr`):**

- ✅ **`createSessionV2` round-trip.** Built via `buildCreateSessionTx`, authority-signed, landed with
  `skipPreflight: false` (so it passed simulation AND execution). The session token was created,
  owned by Keysp (`KeyspM2ss…`, 144 bytes), then `revokeSessionV2` closed it with rent refunded.
  Sigs: create `Dprhz155uQx72K6DP19qRo4brArbDFcbgUd3LnwLUxcKxnCZjDx7…`, revoke
  `4exRKsfrzCifPBFxCMkuNoykDssKkEVq1ZQQfMdkiSpw9oPJpCKZ1goT…`. This confirms the account set, arg
  order (`true, validUntil, lamports`), PDA seeds, the session co-signing, AND `systemProgram`
  auto-resolution — all correct. The review's "invisible session" risk is **closed**.
- ✅ PDA derivation matches `deriveSessionTokenV2` for the live token.

**Confirmed: the REST builder (`flashapi.trade/v2`) is MAINNET-ONLY.** With `FLASH_V2_CLUSTER=devnet`,
`ensureOnboarded` still returned onboarding txs targeting the **mainnet** Flash program `FTv2Rx…`,
not devnet `FMTgs…`. There is no devnet REST builder, so onboarding/deposit/open/close can only be
validated on **mainnet** (a tiny soak). `resolveProgramId('devnet')` only affects the session
`target_program` scope (set locally); it does not change what the REST builder produces.

**Still needs a mainnet soak (REST-builder-dependent legs):**
1. onboarding (init-basket/ledger/delegate) landing on base.
2. `deposit-direct` crediting + the balance accounting formula.
3. a session-signed open/close landing on the **ER** (`submitErTx`), incl. the ER RPC URL
   (`resolveErRpc`) and `er`-layer blockhash/ALT handling.
4. the `/owner/{owner}` positionMetrics + close-by-symbol+side shapes (Phase 1 surface notes §3
   unconfirmed items).

**Source legend:** on-chain program `magicblock-labs/session-keys` `gpl_session/src/lib.rs`
(master); published IDL `@magicblock-labs/gum-sdk@3.0.10` (`lib/idl/gpl_session.json`); Flash
reference `flash-trade/examples-v2` `examples/tap-trade/{SESSION-KEYS.md,lib/session.ts,lib/signer.ts,package.json}`;
our codebase `file:line` as cited.
