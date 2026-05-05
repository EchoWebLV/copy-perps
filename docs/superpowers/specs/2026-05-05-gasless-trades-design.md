# Gasless Trades — Design

**Date:** 2026-05-05
**Status:** Draft (awaiting review)

## Problem

Today every bet route refuses to proceed unless the user holds ≥ 0.01 SOL ([lib/usd/consolidate.ts:34](../../../lib/usd/consolidate.ts)). Users who deposit only USDC see "you need a tiny bit of SOL" and get stuck. The product promise is "deposit USDC, tap a stake button, done" — the SOL gate breaks that promise.

We want users to fund their wallet with USDC alone, never see SOL, and still trade across all three rails.

## Goals

1. **Zero SOL required from the user.** They deposit USDC. Their SOL balance does not need to be topped up by them, ever.
2. **Profit-positive per bet.** A flat **0.5% profit fee + $0.05 SOL passthrough** is collected in USDC on every open. The platform pays SOL gas; users reimburse it through the passthrough.
3. **Minimum-blast-radius custody.** A hot Gas Wallet (SOL-only, low float) is online; a Treasury Wallet (USDC profits) sits behind colder controls.
4. **Smallest possible code change.** Reuse the existing tx-building paths where we can; only swap fee-payer and add a fee-transfer instruction.

## Non-goals

- **Reclaiming SOL on close.** A future optimization. v1 accepts the small SOL leak from rent that lands in user wallets.
- **Tiered SOL passthrough by rail / cold-start.** Flat $0.05 in v1. If economics demand it we can add cheaper-on-warm / pricier-on-cold later.
- **Withdraw fees.** Server eats the ~$0.001 SOL tx cost on user withdraws.
- **Cron route changes.** The signal-refresh crons sign with their own wallet (none); they don't pay user gas. Out of scope.
- **Migration of pre-existing open positions.** Closes use the new gasless path; there's nothing to migrate on the open side because positions are stateless w.r.t. fee payer.

## Architecture

### Two wallets

| Wallet | Holds | Job | Risk |
| ------ | ----- | --- | ---- |
| **Gas Wallet** (hot) | SOL only | Sign as fee payer on every user tx | If keys leak → lose hot SOL float (target ~$200–500) |
| **Treasury Wallet** | USDC fees | Receives platform-fee USDC transfer at end of each open tx | If keys leak → lose accumulated profit; sweep to cold storage on a cadence |

Two pubkeys, two env vars. The Gas Wallet's private key lives server-side as `GAS_WALLET_PRIVATE_KEY` (base58-encoded). The Treasury Wallet only needs its pubkey on the server (`TREASURY_PUBKEY`); its private key never touches the app.

### Fee structure

For every open bet:

```
total_charged_usdc = stake + (stake × 0.005) + 0.05
                            └── 0.5% profit ──┘   └── SOL passthrough ─┘
```

- The `stake` portion routes into the trade exactly as today.
- The `(stake × 0.005) + $0.05` portion is appended as a single `TransferChecked` instruction (USDC, user → Treasury Wallet) inside the same atomic tx.

Closes and withdraws charge **no fee**. The server absorbs the trivial ~$0.001 SOL tx cost on those flows.

### Server fee-payer pattern

Every user-action tx is composed with **Gas Wallet pubkey at `staticAccountKeys[0]`** (the fee-payer slot). Both signers (Gas Wallet + user) sign before the tx is broadcast.

Flow (per open):

1. Client POST `/api/bet/{rail}` with stake.
2. Server:
   - Validates stake, computes `requiredUsd = stake + 0.5% + $0.05`.
   - Runs `ensureUsdcOrConsolidate({ requiredUsd })` — same code today, just the new amount.
   - Builds the open tx with Gas Wallet as fee payer + appended Treasury fee-transfer ix.
   - Partial-signs the tx with Gas Wallet's keypair.
   - Returns `{ phase: "open", betId, swapTransaction }` (transaction is base64, partially signed).
3. Client signs the tx (adds user's signature) via Privy's `signTransaction`, broadcasts via Helius.
4. Client POST `/api/bet/{rail}/confirm` with the signature → server marks bet `confirmed`.

The client-side helper `postBetWithConsolidation` already handles the consolidate→open dance. It needs no logic changes — Privy's `signTransaction` adds a signature without overwriting the existing Gas Wallet partial sig.

### Per-rail integration

#### Meme rail (Jupiter swap)

Jupiter's `/swap` endpoint bakes the user as fee payer with no override. Switch to `/swap-instructions`:

```ts
// lib/jupiter/swap.ts — new path
export async function buildSwapInstructions(params: {
  quoteResponse: JupiterQuote;
  userPublicKey: string;
  feePayerPublicKey: string;
}): Promise<{
  computeBudgetInstructions: TransactionInstruction[];
  setupInstructions: TransactionInstruction[];
  swapInstruction: TransactionInstruction;
  cleanupInstruction: TransactionInstruction | null;
  addressLookupTableAddresses: string[];
}>
```

We assemble the v0 message ourselves with `payerKey = gasWalletPubkey`, append the Treasury USDC-transfer ix at the end of the instruction list, attach the resolved Address Lookup Tables, and partial-sign with Gas Wallet. ✅ Clean, no tx surgery.

#### Whale rail (Flash perp)

Flash builds we already control in [lib/flash-trade/perp.ts](../../../lib/flash-trade/perp.ts). One-line change at `payerKey: params.userPubkey` → `payerKey: gasWalletPubkey`. Append the Treasury fee-transfer ix to the instruction list. Partial-sign with Gas Wallet. ✅

Note: Flash's position PDA rent (~0.0015 SOL) is paid by the fee payer. After this change Gas Wallet pays it. On close, the rent refunds to the position owner — which is still the user. Net: ~$0.24 of SOL leaks into the user's wallet on every perp close. v1 accepts this; v2 can add a `closeAccount → gasWallet` ix on close.

#### jupUSD → USDC consolidation

Same as Meme rail — switch to `/swap-instructions`, Gas Wallet as fee payer. Appends no Treasury fee — consolidation is overhead, the bet's open-side fee already covers it.

#### Prediction rail (Jupiter Prediction)

Jupiter Prediction's `/orders` returns a fully-baked tx with the user as fee payer; their API exposes no fee-payer override. We use **atomic prefund** (functionally gasless, robust).

Jupiter Prediction's tx pays its own fee + creates a position PDA whose rent (~0.003 SOL, refunded on close) is charged to the fee payer. So the user needs ~0.005 SOL on hand at submit time. Logic:

1. Read user's SOL balance.
2. **If user has ≥ 0.005 SOL** (warm path — prior prediction position closed and rent refunded to them): skip prefund, return only the Jupiter Prediction tx + a separate USDC-fee transfer.
3. **If user has < 0.005 SOL** (cold path — first prediction or all rent currently locked): prefund up to 0.005 SOL.

The route returns up to two transactions:

```json
{
  "phase": "open",
  "betId": "...",
  "prefundTransaction": "<base64 — Gas Wallet drips SOL + sweeps USDC fee> | null",
  "swapTransaction": "<base64 — Jupiter Prediction tx, user as fee payer, untouched>"
}
```

When `prefundTransaction` is present, the client signs and submits it first, waits for confirmation, then signs and submits `swapTransaction`. When null, the client submits `swapTransaction` directly.

The `prefundTransaction` contains, in order:
1. `SystemProgram.transfer` of `(0.005 SOL − userCurrentSol)`: Gas Wallet → user. Skipped if warm.
2. `splToken.transferChecked` USDC fee: user → Treasury Wallet.
3. `createAssociatedTokenAccountIdempotent` for Treasury's USDC ATA (no-op after first time forever).

Gas Wallet is fee payer of the prefund tx (pays its ~$0.001 fee + first-time Treasury ATA rent). User signs to authorize the USDC transfer.

**Cost amortization:** the 0.003 SOL position rent the user "spends" on the prediction tx is refunded to them on close, so it stays in the user's wallet and seeds future warm-path bets. Subsequent prediction trades from that user typically skip the prefund entirely. The unrecoverable SOL leak per cold prediction bet is just `0.005 − 0.003 = 0.002 SOL ≈ $0.32` (the over-prefund margin) plus tx fees. The $0.05 SOL passthrough still nets positive over a user's lifetime of bets; it loses on the very first cold prediction bet and breaks even by the third.

**Why atomic prefund over tx surgery:** rewriting Jupiter Prediction's v0 message (insert Gas Wallet at index 0, increment every account index in every instruction) is fragile — silent breakage if Jupiter changes their tx layout. Atomic prefund only depends on stable Solana primitives (System + SPL Token).

Trade-off: on the cold path, user wallet briefly holds up to ~0.005 SOL (~$0.80) between the two txs. From a UX perspective this is invisible (we never display SOL); not "user SOL ledger never moves" in the strictest sense.

### Withdraw

Same fee-payer swap as the bet routes. No platform fee — server eats the ~$0.001 SOL tx cost. The existing consolidate-before-withdraw step ([app/api/withdraw/route.ts](../../../app/api/withdraw/route.ts)) keeps working, just with Gas Wallet as fee payer on the consolidation swap and the final transfer.

### Wallet refuel

Two distinct SOL thresholds, used for different purposes:

| Constant | Value | Used by |
| -------- | ----- | ------- |
| `GAS_WALLET_MIN_BALANCE_SOL` | 0.05 SOL | Per-request preflight. Bet routes return HTTP 503 if Gas Wallet drops below this — better than building a tx that will fail. |
| `GAS_WALLET_REFUEL_TRIGGER_SOL` | 1 SOL | Operator-side refuel signal. Above the per-request floor; gives plenty of runway to do the refuel before any user is impacted. |

When Gas Wallet drops below `GAS_WALLET_REFUEL_TRIGGER_SOL` (≈ $160), an operator does:

1. Check Treasury USDC balance.
2. Run a Jupiter swap **on the Treasury Wallet** for `REFUEL_AMOUNT_USDC` (initial value $200) → SOL.
3. Transfer the resulting SOL from Treasury → Gas Wallet.

For v1 this is a manual scripted op — `scripts/refuel-gas-wallet.mjs`. For v2 it can be cron-driven once stable.

## Implementation surface

### New files

- **`lib/wallets/gas.ts`** — loads `GAS_WALLET_PRIVATE_KEY`, exports `gasWalletKeypair`, `gasWalletPubkey`, helper `partialSignAsFeePayer(tx)`.
- **`lib/wallets/treasury.ts`** — loads `TREASURY_PUBKEY`, exports `treasuryPubkey`, helper `buildFeeTransferIx({ user, feeUsdc })` that returns a TransferChecked instruction (USDC ATA → Treasury USDC ATA, with idempotent ATA-create-if-missing for Treasury).
- **`lib/fees/calc.ts`** — `computeBetFee(stakeUsdc): { profitUsdc, solPassthroughUsdc, totalFeeUsdc }`. Pure function.
- **`scripts/refuel-gas-wallet.mjs`** — manual op script. Reads Gas Wallet balance, prompts for confirmation, swaps Treasury USDC → SOL, transfers SOL to Gas. Reuses `lib/jupiter/swap.ts`.

### Modified files

- **`lib/usd/consolidate.ts`** — delete `requireSolForBet`, `InsufficientSolForFeesError`, `MIN_SOL_FOR_BET`. `ensureUsdcOrConsolidate` updated to accept `requiredUsd` already inclusive of fee.
- **`lib/jupiter/swap.ts`** — add `buildSwapInstructions` calling Jupiter `/swap-instructions`. Existing `buildSwap` stays for any non-bet caller (we'll grep — likely none).
- **`lib/flash-trade/perp.ts`** — both `buildOpenPerpTx` and `buildClosePerpTx`: `payerKey: gasWalletPubkey`, append Treasury fee ix on open, partial-sign with Gas Wallet.
- **`app/api/bet/meme/route.ts`** — remove `requireSolForBet`. Compute `requiredUsd = amount + fee`. Build tx with Gas Wallet fee-payer path. Insert bets row with original `amount` (the trade portion); fee is recorded on the same row via new `feeUsdc` column.
- **`app/api/bet/prediction/route.ts`** — remove `requireSolForBet`. Build prefund tx (gas drip + USDC fee transfer). Return `{ prefundTransaction, swapTransaction }`.
- **`app/api/bet/perp/route.ts`** — same shape as meme.
- **`app/api/bet/{rail}/close/route.ts`** — switch to Gas Wallet fee-payer. No fee charged.
- **`app/api/withdraw/route.ts`** — remove `requireSolForBet`. Use Gas Wallet as fee payer for both consolidate and final transfer.
- **`lib/bets/post-with-consolidation.ts`** — small update to handle the prediction `phase: "open"` two-tx response: when both `prefundTransaction` and `swapTransaction` are present, sign+send prefund first, wait for confirmation + 1.5s buffer, then sign+send swap. For other rails the response is unchanged (single `swapTransaction`).
- **`lib/db/schema.ts`** — add `feeUsdc: numeric("fee_usdc", { precision: 20, scale: 6 })` to `bets`. Optional / nullable for backfill compatibility.
- **`.env.example`** — document `GAS_WALLET_PRIVATE_KEY` and `TREASURY_PUBKEY`.
- **`CLAUDE.md`** — update the "USDC consolidation" and "Bet lifecycle" sections to describe the new fee-payer flow.

### New env vars

```
GAS_WALLET_PRIVATE_KEY=<base58 of 64-byte secret key>
TREASURY_PUBKEY=<base58 pubkey>
```

Both required. Server boot fails fast if either is missing.

## Failure modes & edge cases

### Gas Wallet runs dry mid-flow
Server-side preflight: every bet route checks `gasWalletBalance >= GAS_WALLET_MIN_BALANCE_SOL` (0.05 SOL) before building the tx. If under, return HTTP 503 with a clear error ("temporarily unable to open positions, try again in a moment"). Operator gets paged. This is way better than handing the client a half-built tx that fails on submit.

### Treasury USDC ATA doesn't exist
First time we try to transfer USDC there, the ATA doesn't exist. The fee-transfer ix-builder includes an idempotent `createAssociatedTokenAccountIdempotent` for the Treasury's USDC ATA. Gas Wallet pays the rent (~$0.20, one-time forever). Subsequent transfers are bare TransferChecked.

### User cancels prediction prefund mid-flow
User signs the prefund (gets SOL drip + fee transfer to Treasury), then bails before signing the prediction tx. Result: Treasury has the user's $0.075 fee, user has $0.001 of SOL dust, but no position. The bet row is `pending` and ages out to `abandoned` after 5 minutes per the existing reaper at [app/api/portfolio/route.ts](../../../app/api/portfolio/route.ts). The fee is genuinely captured for a non-position. Acceptable — same behavior as Robinhood charging an order routing fee for a canceled order.

(If we want to refund: add a 5-minute background reaper that detects `abandoned` prediction bets and issues a Treasury → user USDC refund. Tracked as v2.)

### Insufficient USDC after fee added
`ensureUsdcOrConsolidate` already throws `InsufficientCombinedBalanceError` when USDC + jupUSD < required. The error message is unchanged, just the threshold is `stake + fee` instead of `stake`. Frontend already surfaces this.

### Privy's `signTransaction` overwriting partial sigs
**Verified concern.** Privy's Solana embedded wallet (`@privy-io/react-auth/solana` `useSignTransaction`) signs without overwriting other signers' signatures — it merges. Confirm during impl: a unit-test-equivalent local test (sign a tx that's already partial-signed, verify both sigs land). If Privy ever does overwrite, fallback is to broadcast the prefund tx server-side instead of returning it to the client.

### Jupiter Prediction tx structure changes
Atomic prefund insulates us from this — we never touch their tx. If Jupiter changes the prediction tx layout, our prefund tx still works.

### Concurrent bets from one user
Each bet route reads SOL/USDC balance, builds tx, returns. If user fires two bets in parallel: each tx is built independently with the same blockhash window. Both go on chain. The second may fail simulation if there isn't enough USDC for both fees, but that's already how the codebase handles concurrent bets. No new race.

## Cost model (operator-facing)

Per-bet revenue (USDC): `0.5% × stake + $0.05`.
Per-bet cost (SOL → USD): `$0.001` (warm bet) to `$0.30` (cold bet, new ATA).

Average estimate, 80% warm bets / 20% cold bets, $20 mean stake:
- Revenue: `0.5% × $20 + $0.05 = $0.15`
- Cost: `0.8 × $0.001 + 0.2 × $0.30 = $0.06`
- Profit: `$0.09 per bet ≈ 0.45% of stake`

For warm-only flow (steady-state user): revenue $0.15, cost $0.001, profit ≈ $0.149 (0.74% of stake).

## Rollout

1. Implement and ship behind a feature flag (`FEATURE_GASLESS_BETS=true`) in a single Vercel deploy.
2. Test with one team-owned wallet on mainnet across all three rails (small stakes).
3. Flip the flag for all users.
4. Monitor Gas Wallet balance hourly for 48h.
5. Once stable, delete the flag and remove the now-dead `requireSolForBet` references.

## Out of scope (v2 ideas)

- SOL reclaim on close (sweep user's spare SOL > 0.001 back to Gas Wallet).
- Tiered SOL passthrough (cheap on warm, more on cold-start).
- Auto-refuel cron (no manual ops).
- Refund mechanism for `abandoned` prediction bets where the prefund landed.
- Close-fee on perp (Flash already takes one; we may stack a tiny one for symmetry).
