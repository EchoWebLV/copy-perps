# Flash copy-trading (auto-open + auto-close on source close)

2026-06-12. User ask: "copy trade people or bots, copy a position and be able
to close whenever the whale closes" — pure Flash (signal venue == execution
venue for humans; arena bots stay the signal for bots).

## What already exists (reused, not rebuilt)

- **Execution**: `getFlashPerpsService()` open/close/positionsOf — builds
  unsigned Flash txs for any trader wallet ([lib/flash/perps.ts](../../../lib/flash/perps.ts)).
- **Automated signing**: `signAndSendPrivySolanaTransaction` — Privy
  authorization-key signing, proven in prod by Scalp Autopilot
  ([lib/autopilot/engine.ts](../../../lib/autopilot/engine.ts)).
- **Bookkeeping**: flash-tail bets rows (`bets.type='flash-tail'`,
  `FlashTailMeta`) + fills + the reconcile sweep for external closes.
- **Auto-close precedent**: the Pacifica copy stack already auto-closes
  whale tails (`runMirrorCloseSweep`, `meta.autoCloseOnSourceClose`). The
  FLASH stack has no auto-close — that gap is half of this build.
- **Ticker pattern**: lease-guarded in-process loop started from
  instrumentation.ts (whale ticker, autopilot ticker). Neon-cost rule:
  idle loops must be near-free.

## New concepts

### Targets

- `arena-bot` — persona name (e.g. `degen-v1`). Source of truth: bot PDA
  account read from the ER RPC, decoded with [lib/arena/decode.ts](../../../lib/arena/decode.ts).
  Position key: `arena:<persona>:<openedTsMs>` (existing tail convention).
- `flash-wallet` — any Solana wallet trading Flash perps. Source of truth:
  `positionsOf(wallet)`. Flash merges positions per (owner, market, side),
  so the key is `flash:<wallet>:<market>:<side>` (no openedTs available;
  close+reopen between polls reads as the same position — accepted at ~3s
  polls).

### copy_subscriptions table (standing auto-copy)

One row per (user, target): stakeUsdc per copy, leverageMode
`mirror|fixed` (+fixedLeverage), autoClose, maxConcurrent, dailyCapUsd,
maxEntryGapBps, status `active|paused|stopped`. Partial unique index: one
non-stopped sub per (user, targetKind, targetKey).

### Copied positions are flash-tail bets rows

No parallel positions table (autopilot precedent). Subscription opens write
`bets` rows via `recordFlashTailOpen` with meta extensions:

- `copySubscriptionId: string|null` — attribution (mirrors autopilotSessionId)
- `autoCloseOnSourceClose: boolean` — close-pass opt-in
- `closeReason` union gains `'source-closed'`
- flash-wallet lineage reuses sourceKind `'whale'` with
  `whaleId='flash:<wallet>'` so the portfolio renders unchanged.

Manual tails get the same powers: TailModal grows an "auto-close when
{source} closes" checkbox → `/api/flash/perp` body `tail.autoClose` → same
meta flag. Bot tails already carry `sourcePositionId=arena:<persona>:<ts>`,
so the close pass covers them with zero migration.

## Engine (lib/copy/engine.ts, injected deps, TDD)

Each tick:

1. Load active subscriptions + open autoClose flash-tail bets → watch set
   of targets. Empty set ⇒ idle (no RPC).
2. Fetch each target's positions once (shared by open+close passes).
3. **Close pass**: for each open autoClose bet whose `sourcePositionId` is
   no longer in its target's live keys → build close → sign → confirm with
   closeReason `source-closed`. Follower position already gone (manual
   close/liquidation raced) → confirm bookkeeping-only with `external`.
4. **Open pass** (subscriptions): diff vs previous in-memory snapshot;
   bots additionally pick up positions younger than MAX_COPY_AGE_SEC (90s)
   missing from bets (restart catch-up). Guards, each logged as a skip:
   leverage clamp to venue bounds → notional ≥ $10 (FLASH_MIN_NOTIONAL_USD)
   → wallet stacking guard (positionsOf(follower) — Flash merges per
   market+side; never stack) → maxConcurrent → dailyCap → entry-gap
   (|mark−sourceEntry| in bps vs maxEntryGapBps, getMark = oracle-fresh
   marks) → execute (record → send → confirm; record-before-send mirrors
   the autopilot crash-ordering rationale).
5. In-memory attempted-set prevents intra-process refires; bets-row dedup
   (copySubscriptionId+sourcePositionId) prevents cross-restart doubles.

DRY-RUN (`COPY_DRY_RUN=true`): full pipeline, log-only, zero writes/sends.

## Ticker (lib/copy/ticker.ts)

Clone of autopilot ticker: `copy_ticker_lease` (raw-SQL ensure, 180s TTL),
kill switch `DISABLE_COPY_TICKER`, gap `COPY_TICK_GAP_MS` default 3000 —
fast polls are RPC-only; DB touched on 30s lease beats, 15s watch-set
refresh, and event writes. Idle (empty watch set) ⇒ 30s sleeps, no RPC.
Started from instrumentation.ts.

## API + UI

- `GET/POST /api/copy/subscriptions`, `PATCH/DELETE /api/copy/subscriptions/[id]`
  (Privy auth, ensureUser; targetKind validation: persona must be in
  ARENA_PERSONAS / wallet must parse as PublicKey).
- Bot cards: **Copy** button → CopyModal (stake presets, mirror/fixed
  leverage, auto-close toggle, daily cap) → POST subscription.
- TailModal: auto-close checkbox on bot tails (v1; whale kinds keep the
  Pacifica stack's behavior).
- Portfolio "Copy trading" section: subscriptions w/ pause/stop, copied
  history (bets where copySubscriptionId set), + "copy a Flash wallet"
  address form.

## Limits / honest notes

- Entry latency ≈ poll gap (3s) + Solana landing (~1–2s). Fine for
  trend riders, costly for 50s scalpers — that's what maxEntryGapBps is
  for. Default 100bps.
- $1 stakes can't carry Flash TP/SL triggers (≥$10 collateral) — exits are
  the source close, the engine's job.
- Liquidations of follower copies are caught by the existing flash
  reconcile sweep ('closed-external').
- Flash-wallet targets must trade markets we support (SOL/BTC/ETH Crypto.1)
  — others skipped with a logged reason.
