# Flash Trade v2 Migration — Replace Pacifica execution with Flash v2 (MagicBlock ER) — Design

**Date:** 2026-06-19
**Status:** Proposed (design approved in session; pending written-spec review)
**Branch:** `feat/flash-v2-migration`
**Trigger:** "make a new branch and implement flash v2 for copy trading and remove completely pacifica."

## 1. Summary

Today every real-money action on gwak.gg — deposit, open, close, withdraw, portfolio,
whale tail, copy — executes on **Pacifica** (`lib/pacifica/*`, program
`PCFA5iYgmqK6MqPhWNKg7Yv7auX7VZ4Cx7T1eJyrAMH`). This design moves **all execution to
Flash Trade v2** and removes Pacifica as an execution venue.

Flash Trade v2's perpetuals program (`FTv2RxXarPfNta45HTTMVaGvjzsGg27FXJ3hEKWBhrzV` on
mainnet) runs on a **MagicBlock Ephemeral Rollup**: a user's "basket" is delegated to the
ER, trades execute against an ER RPC at low latency, and state commits to Solana base
layer on a ~10s cadence. Integration is via a **public REST transaction-builder API**
(`https://flashapi.trade/v2`, no API key) that returns unsigned, base64 versioned
transactions — the client signs with the Privy embedded wallet and broadcasts. This is
the **same "server builds, client signs" shape we already run for Pacifica**, so the
signing/broadcast plumbing is reused; only the venue lib and the onboarding lifecycle
change.

## 2. Scope (reconciled)

Pacifica serves two distinct roles in the codebase. "Remove completely Pacifica" applies
to the first; "keep Hyperliquid and Pacifica" (user, 2026-06-19) preserves the second:

- **Execution (money) — REMOVE, replace with Flash v2.** Deposit, open/close, withdraw,
  account/balance reads, the server-held agent wallet, deposit reconciliation.
- **Discovery (read-only signals) — KEEP.** The Pacifica leaderboard and reading whale
  wallets' positions to decide *what* to copy — no money, no user accounts on Pacifica —
  stay, now as one of two discovery sources alongside Hyperliquid.

This is the repo's existing **"signal source ≠ execution venue"** principle (CLAUDE.md:
whale signals from Hyperliquid; execution elsewhere). Result:

> **Execution: 100% Flash v2. Discovery: Hyperliquid + Pacifica leaderboard (read-only).
> All Pacifica execution code deleted; Pacifica leaderboard-read code kept.**

### Delete (Pacifica execution)
`lib/pacifica/deposit.ts`, `withdraw.ts`, `orders.ts`, `deposit-reconcile.ts`, the
agent-bind path in `client.ts`/`sign.ts`, and the account/balance reads. Rewire the
execution routes (§10).

### Keep (Pacifica discovery, read-only)
`lib/pacifica/leaderboard.ts`, `getLeaderboard` + whale-wallet `getPositions` in
`client.ts`, `lib/whales/refresh-pacifica.ts`, `lib/whales/pacifica-source.ts`,
`lib/sources/pacifica-wallet.ts`, `lib/signals/whale-signals.ts`,
`lib/whales/source-monitor.ts` (read-only WS). `lib/pacifica/sign.ts` is retained ONLY if
a kept read path still needs signed reads; otherwise it is deleted with execution.

### Build new (`lib/flash-v2/*`)
The venue lib, the ER onboarding lifecycle, session keys, two-phase withdraw, balance
accounting, live marks, sizing, and the venue interface (§6).

## 3. Verified current state (2026-06-19)

- **Branch topology:** `main == origin/main == feat/arena-on-redesign` at `00b61ed`. This
  checkout is the canonical/live tip.
- **Pacifica is the execution venue**, wired into **9 routes**: `bet/copy`(+close),
  `trade/perp`(+close), `bet/whale`, `users/me/deposit`, `users/me/agent/bind`,
  `withdraw/pacifica`, `portfolio`. Full surface inventory: `lib/pacifica/` (client,
  deposit, deposit-reconcile, leaderboard, live-context, markets, orders, sign, sizing,
  types, withdraw) + consumers in `lib/bets/*`, `lib/whales/*`, `lib/data/*`, and the
  app layout/portfolio/tail components.
- **Pacifica REST** `https://api.pacifica.fi/api/v1`; **WS** `wss://ws.pacifica.fi/ws`.
- **Agent-wallet model:** a server-held agent keypair is bound once to the user's account
  (`bindAgentWallet`), letting the server place copy / auto-close orders without a
  per-order wallet popup. **This is the most load-bearing piece to replace** (§9).
- **Flash today is dead-on-this-branch:** `flash-sdk@15` (program `FLASH6Lo…`, Flash v1)
  exists under `lib/flash/*` + `app/api/flash/perp/*` but nothing user-facing executes on
  it. This migration targets **v2** (a different program, different API), not the v1 SDK.

## 4. Flash Trade v2 integration surface (verified via docs.flash.trade, 2026-06-19)

- **Program IDs:** mainnet `FTv2RxXarPfNta45HTTMVaGvjzsGg27FXJ3hEKWBhrzV`; devnet
  `FMTgsEDaPPfJi1PKD67McLTC5n833T4irbBP53LLxtvj`.
- **REST builder:** base `https://flashapi.trade/v2`, **no API key, public**. Every
  transaction-builder endpoint returns an **unsigned base64 versioned transaction**; the
  client deserializes, signs, submits (identical to our Pacifica `buildDepositTx` flow).
- **MagicBlock ER:** `delegate-basket` delegates the basket to validator
  `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57`, commit frequency 10,000ms
  (both protocol-fixed server-side; the request only needs `{payer, owner}`). Post-
  delegation, **trading state lives on the ER** — queries must hit the ER first.
- **TypeScript reference:** `flash-trade/examples-v2` (typed client `packages/flash-v2`,
  walkthrough `lifecycle.ts`, `GOTCHAS.md`); also a v2 CLI and MCP.

### Transaction-builder endpoints (POST, return unsigned tx)
| Step | Endpoint | Body (key fields) |
|---|---|---|
| init basket | `/transaction-builder/init-basket` | `{owner}` |
| init deposit ledger | `/transaction-builder/init-deposit-ledger` | `{owner}` |
| delegate basket | `/transaction-builder/delegate-basket` | `{payer, owner}` |
| deposit | `/transaction-builder/deposit-direct` | `{owner, tokenMint, amount}` |
| open | `/transaction-builder/open-position` | `{owner, inputTokenSymbol, outputTokenSymbol, inputAmountUi, leverage, tradeType, orderType, takeProfit?, stopLoss?}` |
| close | `/transaction-builder/close-position` | `{owner, positionKey, inputUsdUi, withdrawTokenSymbol, keepLeverageSame?}` |
| trigger TP/SL | `/transaction-builder/place|edit|cancel-trigger-order` | `{triggerPriceUi, sizeAmountUi, isStopLoss, ...}` |
| withdraw (phase 1) | `/transaction-builder/request-withdrawal` | (queues settlement) |
| withdraw (phase 2) | `/transaction-builder/execute-withdrawal` | (consumes settlement receipt) |

### Query endpoints (GET / WS)
| Data | Endpoint |
|---|---|
| positions | `GET /positions/owner/{wallet}?includePnlInLeverageDisplay=true` |
| all prices | `GET /prices` (Pyth Lazer, ~200ms) |
| one price | `GET /prices/{SYMBOL}` |
| markets + max leverage | `GET /raw/markets` |
| pool data | `GET /pool-data` |
| live owner stream | `WS /v2/owner/{owner}/ws` — `basket` (full) + `metrics` (positions, per tick) frames |

### Onboarding lifecycle (chain-enforced order)
`init-basket → init-deposit-ledger → delegate-basket → deposit → trade → withdraw`. The
API exposes each step independently and **does not check ordering — the program does**.
Detect uninitialized wallets via a null `basketPubkey`.

## 5. Architecture

```
                    ┌──────────────── venue interface (lib/flash-v2/venue.ts) ────────────────┐
 app/api/* routes ─►│ ensureOnboarded · deposit · withdraw · openPosition · closePosition     │
 (execution)        │ getPositions · getBalance · getMarks · getMarkets                       │
                    └───────────────────────────────┬───────────────────────────────────────┘
                                                     │  (the only execution venue)
                    ┌────────────────────────────────▼──────────────────────────────────────┐
                    │ lib/flash-v2/*  — REST client over https://flashapi.trade/v2            │
                    │  builder.ts (unsigned tx) · query.ts (positions/prices/markets)         │
                    │  onboard.ts (basket/ledger/delegate) · withdraw.ts (two-phase)          │
                    │  session.ts (GPL session keys) · accounting.ts (balance formula)        │
                    │  sizing.ts (entry-spread-aware) · pnl.ts (mark-price) · live.tsx (WS)   │
                    │  errors.ts (body.err / 400 / 500 normalization) · rpc.ts (dual-RPC)     │
                    └─────────────┬───────────────────────────────────┬─────────────────────┘
                  base-chain RPC  │ (setup, deposit, withdraw)        │ ER RPC (trades, owner state)
                                  ▼                                   ▼
                          Solana base layer                  MagicBlock ER (FTv2 program)
   ┌─ Discovery (read-only, unchanged money-wise) ─────────────────────────────────────────┐
   │  Hyperliquid curated whales (lib/hyperliquid/*) + Pacifica leaderboard reads           │
   │  (lib/pacifica/leaderboard.ts, client getLeaderboard/getPositions) → whale signals     │
   └───────────────────────────────────────────────────────────────────────────────────────┘
```

- **One venue interface.** Routes call `lib/flash-v2/venue.ts`, never Flash internals.
  This is also what makes Pacifica deletion safe: the routes change their import, not
  their orchestration shape.
- **Signing path reused.** The builder returns unsigned versioned txs; the existing Privy
  sign-and-broadcast path submits them. Setup/withdraw txs → base-chain RPC + blockhash;
  trade txs → ER RPC + blockhash. **Mixing them fails** (gotcha) — `rpc.ts` owns the
  routing so no caller can get it wrong.
- **Dual data path.** Reads of delegated (post-delegate) state query the ER first; setup
  reads use base chain.

## 6. Venue interface (`lib/flash-v2/venue.ts`)

```ts
interface PerpVenue {
  ensureOnboarded(owner): Promise<OnboardStep[]>;      // basket/ledger/delegate as needed
  deposit({ owner, amountUsdc }): Promise<UnsignedTx>;
  withdraw({ owner, amountUsdc }): Promise<WithdrawTicket>;  // two-phase (§8)
  openPosition({ owner, symbol, collateralUsd, leverage, side, orderType, tp?, sl? }): Promise<UnsignedTx & Quote>;
  closePosition({ owner, positionKey, closeUsd, full? }): Promise<UnsignedTx>;
  getPositions(owner): Promise<VenuePosition[]>;
  getBalance(owner): Promise<VenueBalance>;            // accounting formula (§ gotchas)
  getMarks(symbols?): Promise<Record<symbol, number>>;
  getMarkets(): Promise<VenueMarket[]>;                // symbol, max leverage
}
```

The interface is intentionally venue-agnostic so a future venue is a new implementation,
not a rewrite of the routes. Only `lib/flash-v2/` implements it for now.

## 7. Capability mapping (Pacifica → Flash v2)

| Capability | Pacifica today | Flash v2 | Action |
|---|---|---|---|
| Deposit | `buildDepositTx` → vault | onboarding + `deposit-direct` | rebuild (lifecycle) |
| Open | `openCopyOrder` | `open-position` | rebuild |
| Close | `closeCopyOrder` (reduce_only) | `close-position` (`positionKey`) | rebuild |
| Read positions | `getPositions` | `GET /positions/owner/{wallet}` | rebuild |
| Account balance | `getAccountInfo` | **compute** `ledger.deposits − basket.debits + basket.pendingCredits`, ER-first | rebuild |
| Withdraw | `requestWithdraw` (1-phase) | **two-phase** request→poll→execute | rebuild |
| Live marks | WS `useLiveMark(s)` | `GET /prices` + `WS /v2/owner/{owner}/ws` | rebuild |
| Markets / leverage | `getMarkets`/`getMaxLeverage` | `GET /raw/markets` | rebuild |
| Sizing | lot rounding from notional | `inputAmountUi`+leverage, **entry spread reshapes size** | rebuild |
| Server-side copy auth | bound agent wallet | **GPL session keys** | rebuild (§9) |
| Realized PnL | `getPositionsHistory` | mark-price client-side (ignore indexer) | rebuild |
| Deposit reconcile | on-chain + balance history | basket/ledger accounting, ER-first | rebuild |
| Whale discovery | Pacifica leaderboard | **kept** (Pacifica read) + Hyperliquid | keep |

## 8. The new flows

### Onboarding (consent-safe)
"Enable" performs **account setup only**: init-basket → init-deposit-ledger →
delegate-basket (+ a session key, §9). The only disclosed transfer at enable time is
~0.01 SOL rent. **Deposits and withdrawals are separate, explicit user approvals** — no
bundled fund transfers (the bundled-transfer pattern is exactly what tripped the
Lighthouse guard in the reported error). Each step is its own signed tx; uninitialized
wallets are detected via null `basketPubkey` and onboarded on demand.

### Deposit
`deposit-direct {owner, tokenMint: USDC, amount}` → base-chain tx → Privy sign →
broadcast. Balance becomes available per the accounting formula once credited; the UI
shows a pending state until then (replaces Pacifica's reconciliation wait).

### Open / close
Open: `open-position {collateralUsd as inputAmountUi, leverage, symbols, tradeType,
orderType}` → ER tx. **Effective size ≠ collateral × leverage** (entry spread); display
effective leverage (size/collateral). Close: `close-position {positionKey, inputUsdUi}`;
a close ≥97% of size triggers the full-close instruction (detect and label it).

### Withdraw (two-phase)
`request-withdrawal` queues settlement → poll unsigned simulations until the receipt is
ready → `execute-withdrawal` consumes it. Map `0xbc4 / AccountNotInitialized` to a
**timing** state, not a failure. Base-chain.

## 9. Session keys (replacing the agent wallet)

Copy trading and auto-close are **server-driven**: the server opens a mirror when a
followed trader opens, and closes it when they exit, without a per-order user popup. On
Pacifica this used a bound agent wallet. Flash v2 uses **GPL session keys**: the session
is created **client-side** (GPL session program), and the v2 API consumes `signer` +
`sessionToken`. Plan:

- At onboarding, the client creates a session key scoped to trading and hands the server a
  `sessionToken` (stored like the agent secret is today, encrypted at rest).
- Server-initiated open/close calls pass `{signer, sessionToken}`; the server signs trade
  txs with the session key and submits to the ER.
- **Validate session pubkeys before submission** — a typo silently falls back to owner
  signing and fails on-chain later (gotcha). Sessions expire; auto-renew or surface a
  re-enable prompt.

This is the **highest-risk** piece (it changes the trust/auth model for server-driven
trades) and is gated first on devnet (§13).

## 10. Per-route migration

| Route | Today (Pacifica) | After (Flash v2) |
|---|---|---|
| `POST /api/users/me/deposit` | `buildDepositTx` | `ensureOnboarded` + `deposit` |
| `POST /api/users/me/agent/bind` | `bindAgentWallet` | session-key registration (or fold into onboarding; route may be renamed `…/session`) |
| `POST /api/withdraw/pacifica` | `requestWithdraw` | `→ /api/withdraw` two-phase |
| `POST /api/trade/perp` (+`/close`) | open/close order | venue `openPosition`/`closePosition` |
| `POST /api/bet/copy` (+`/close`) | open/close order | venue `openPosition`/`closePosition` |
| `POST /api/bet/whale` | open order | venue `openPosition` |
| `GET /api/portfolio` | positions+account+reconcile | venue `getPositions`+`getBalance`+`getMarks` |
| app layout / portfolio / tail | `PacificaLiveProvider`/`useLiveMarks` | `FlashV2LiveProvider`/`useMarks` |

`lib/bets/onboard.ts`, `funding.ts`, `copy-pnl.ts`, `mirror-close.ts` are rewired to the
venue interface. `lib/data/marks.ts` and `candles.ts` move their price source to Flash v2
`GET /prices` (or stay on a neutral source — decided in the plan).

## 11. Gotchas (each handled in `lib/flash-v2/`)

- **Dual-RPC**: `rpc.ts` routes setup/withdraw → base, trades → ER. Never mixed.
- **ER-first queries** for delegated state.
- **Lifecycle ordering** enforced client-side (don't rely on the API; the program rejects
  out-of-order).
- **Error channels**: trade/preview → HTTP 200 with `body.err`; trigger/limit → HTTP 400
  text; setup/withdraw → bare HTTP 500. `errors.ts` normalizes; always branch on
  `body.err`.
- **No bundled transfers** in onboarding (consent + Lighthouse guard safety).
- **Balance** = `ledger.deposits − basket.debits + basket.pendingCredits`; never display a
  single component.
- **Sizing**: entry spread reshapes size; show effective leverage. `$11` minimum for
  triggers; default ≥ $11.
- **Close ≥97%** = full-close instruction (detect via the equivalent of
  `guards.isFullClose()`).
- **Reverse** applies a 2% haircut (if reverse is used).
- **WS frame merging**: fold `metrics` into the last `basket` snapshot; ≤5 connections per
  owner.
- **Endpoint asymmetry**: setup/withdraw take **mint pubkeys**; trading takes **symbols**.
  Unknown mints assume 6-decimal legacy SPL — wrong for Token-2022; pin USDC explicitly.
- **V1 DTO reuse**: swap fields null on MagicBlock; the `youRecieveUsdUi` typo is real —
  don't rename/coerce.
- **Latency is geography**, not the rollup — optimistic UI + stream reconciliation, not
  polls.
- **Indexer PnL ≠ product PnL** — compute mark-price PnL client-side (fees + borrow only).

## 12. Error handling

`lib/flash-v2/errors.ts` exposes typed guards mirroring Pacifica's settling/timing errors
so routes keep their existing UX branches: `FlashOnboardingRequiredError`,
`FlashDepositPendingError`, `FlashWithdrawSettlingError` (maps `0xbc4`),
`FlashSessionExpiredError`, `InsufficientCollateralError`. Lighthouse-style simulation
guard failures surface as a retriable timing/onboarding state, never a hard failure.

## 13. Testing & rollout

- **Feature flag** `FEATURE_FLASH_V2` (default off). While off, Pacifica execution stays
  live; while on, routes use the venue interface.
- **Devnet-first** against `FMTgs…`: drive the full lifecycle (onboard → session →
  deposit → open → close → withdraw) end-to-end; verify ER-first reads, two-phase
  withdraw, and a server-driven copy open/close via the session key.
- **Vitest** for: accounting-formula math, sizing (entry-spread), error normalization,
  lifecycle-ordering guard, WS frame merge, mark-price PnL, venue-interface contract.
- **Mainnet soak** behind the flag: one in-house wallet does onboard → small deposit →
  open → close → withdraw on `FTv2…`; reconcile balances.
- **Cutover**: flip the flag to default-on, then **delete Pacifica execution code last**
  so a working path always exists. Pacifica discovery (leaderboard) untouched throughout.

### Phasing
1. **P1** — `lib/flash-v2/*` venue lib + onboarding + session keys, devnet, behind flag.
2. **P2** — trade/copy/whale + portfolio (open/close/positions/balance/marks).
3. **P3** — two-phase withdraw + deposit pending UX.
4. **P4** — mainnet soak, flag default-on, delete Pacifica execution + rewire discovery.

## 14. Risks & open items

1. **Session keys vs server-driven copy** — the biggest risk. If server-side trading via
   session token doesn't cleanly support unattended auto-close, copy/autopilot UX changes.
   Verify on devnet in P1 before building P2.
2. **Account-balance/withdrawable** has no direct endpoint — relies on the accounting
   formula + ER reads; confirm against `examples-v2 lifecycle.ts`.
3. **Token-2022 / mint decimals** — pin USDC mint + decimals explicitly everywhere.
4. **Markets parity** — confirm the symbols we copy/trade exist on Flash v2 (`GET
   /raw/markets`); Pacifica's market list (incl. equities/metals) may not map 1:1.
5. **Discovery vs execution market mismatch** — a whale/leaderboard position in a symbol
   Flash v2 doesn't list can't be mirrored; define the skip/label behavior.
6. **Withdraw settlement latency** — two-phase polling UX; pick timeouts.
7. **Privy + ER blockhash** — confirm the Privy sign path accepts an ER-blockhash
   versioned tx and ALT resolution (we already sign-and-broadcast ourselves for ALTs).

## 15. Out of scope

- Reviving Flash **v1** (`flash-sdk`/`FLASH6Lo`) — this is v2 only.
- Changing the arena (on-chain bot arena is a separate MagicBlock ER program; untouched).
- Removing Pacifica **discovery** (leaderboard reads stay).
- New product features beyond venue parity (TP/SL ladders, limit orders) unless needed for
  parity; can be P5.

## Decisions log

1. **Full migration** — all execution to Flash v2, `lib/pacifica` execution deleted (user,
   2026-06-19).
2. **Discovery stays on Hyperliquid + Pacifica leaderboard** (read-only); only execution
   moves (user, 2026-06-19).
3. **Venue interface** so routes are venue-agnostic and Pacifica deletion is a safe import
   swap.
4. **Devnet-first behind `FEATURE_FLASH_V2`; delete Pacifica execution last** — always
   keep a working money path.
5. **Session keys** replace the bound agent wallet for server-driven copy/auto-close;
   gated first on devnet as the highest-risk item.
6. **Onboarding is setup-only, deposits/withdrawals are explicit** — no bundled transfers
   (consent + Lighthouse-guard safety).
