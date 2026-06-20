# Arena bots: smarter multi-asset, multi-action trading

**Date:** 2026-06-21
**Status:** Design approved, spec under review
**Area:** on-chain LLM "arena" (gwak.gg) — `lib/arena/llm/*`, `scripts/arena/*`, `arena-program/*`

## Problem

The arena LLM bots reason about BTC/ETH/SOL but **only ever trade SOL**. The worker
hardcodes `MARKET_ID = 0` and the model's chosen `asset` is discarded
([llm-operator-worker.ts:31,135](../../../scripts/arena/llm-operator-worker.ts)), so a
bot that "shorts ETH" actually shorts SOL. Each bot also makes exactly one
open/close/hold decision per tick, can hold only a SOL position, and is leverage-capped
low. We want bots that are smarter and more expressive: trade the top majors, take
**multiple actions in one tick** (e.g. close SOL, open BTC, open ETH), and **size up
leverage on conviction**.

## Goal

- Bots trade the **top ~6 majors**: BTC, ETH, SOL, BNB, XRP, DOGE (final set gated on
  feed availability, see Dependencies).
- A bot can hold **up to 4 simultaneous positions** in different assets.
- One tick can emit **multiple actions** (open 2 + close 1, etc.).
- **Variable / higher leverage** chosen by the model, bounded by a per-bot cap.
- The model's `asset` choice actually routes to that asset's market.

## Non-goals

- **No on-chain program upgrade.** The arena program already supports up to 8 markets
  (`MAX_MARKETS=8`), per-market `apply_decision`, up to 4 positions per bot
  (one per market), per-market `maintain`/stop/liq, and a model-chosen leverage clamp.
  Everything below is off-chain code + admin `tune` + market setup using existing
  instructions.
- **Not real Flash execution.** Bots paper-trade on the arena program; "all assets"
  means "every asset we stand up an arena market + feed for."
- **Not per-asset LLM calls.** We keep **one LLM call per bot per tick** (the model
  returns a list of actions in a single response), preserving the ~92% cost saving from
  the reasoning-effort optimization.

## Architecture

### 1. Decision schema → list of actions (`lib/arena/llm/schema.ts`)

Replace the single decision with a bounded list:

```
decisionSchema = {
  actions: Action[]   // 0..4 entries; [] (or all "hold") = do nothing this tick
}
Action = { action: open|close|hold, asset, side, leverage, stakeFracPct,
           stopLossPct, takeProfitPct, confidence, reasoning }
```

- `ARENA_ASSETS` grows to the chosen majors; `asset` enum widens accordingly.
- Array cap = 4 (the position-slot count). Opens beyond free slots are no-ops on-chain.
- Keep a top-level one-sentence `rationale` for the tick (UI "why" layer).
- Backwards note: the `DecisionRecord`/persistence + UI tape read one action per row, so
  a multi-action tick persists N rows (one per action) joined on the tape `tsMs`.

### 2. Floor evaluation per action (`lib/arena/llm/floor.ts`)

`evaluateDecision` becomes `evaluateActions(decision, params, liveState, now)` →
`FloorOutcome[]` (one per action). Each action runs the existing per-action floor
(clamp leverage/stake, stop band, confidence, halt/cooldown/trade-cap). CLOSE stays
cooldown-exempt. The function is pure and unit-tested with the same parity cases as
`paper_llm.rs`.

### 3. Asset → market routing + multi-submit (worker + a small map)

A single source-of-truth map `ASSET_MARKETS: Record<ArenaAsset, { marketId, feed }>`
(new `lib/arena/markets.ts`), e.g. `SOL→{0, solFeed}`, `BTC→{1, btcFeed}`, ….
The worker:

1. Builds the brief with **all majors' data + the bot's full multi-asset book**.
2. Makes **one** LLM call → `actions[]`.
3. For each surviving action, routes `asset → {marketId, feed}` and submits an
   `apply_decision` to that market (N txs per tick, each ~$0.001 ER fee).
4. Persists one decision row per action.

The `loop.ts` `runBotDecision` returns a list of per-action results; the daily-heartbeat
gate (already shipped) stays as the first step.

### 4. Brief: multi-asset book (`lib/arena/llm/brief.ts`)

`renderBookBlock` lists every active position with its **asset label** (not `mkt1`),
entry/stake/stop, so the model can rebalance (close a loser, open new ideas). The market
block already renders per-asset rows; it extends to the wider asset set.

### 5. On-chain markets + feeds (per asset)

For each new asset: `init_market(marketId, feed)` + `delegate_market(marketId)` on
mainnet, where `feed` is a **MagicBlock `pricing_oracle` Lazer PDA** (same mechanism as
the SOL feed `ENYweb…`, price@73 / publish_ts@93). One-time admin setup via a new
`scripts/arena/init-markets.ts` (mirrors `init-devnet.ts`). Fallback if MagicBlock lacks
an asset: self-publish a Lazer feed account (see Dependencies).

### 6. Crank ticks all markets (`lib/arena/crank-deps.ts`)

`FEEDS` grows to one row per asset; `listMarkets()` returns every active market so
`tick`/`commit_state` run per-market. This is what keeps per-position stop/liq/funding/
max-hold running continuously (~2s) on **all** open positions, independent of the LLM.
The crank-worker is already deployed; it just needs the markets + feeds wired.

### 7. Tune for the new behavior (`scripts/arena/bot-tuning.ts` → `npm run arena:tune`)

- `cooldownSecs → 0` for bots meant to act multiple times per tick (the only thing
  blocking back-to-back opens; tune value, not code).
- raise `maxLeverage` (e.g. aggressive bots up to 50x, the schema ceiling; patient lower).
- raise `maxTradesPerDay` to accommodate multi-open ticks.
- Guardrails unchanged: `dailyLossLimitBps` kill-switch, `maxStakeFracBps` size cap,
  per-position stop/liq via the crank, the heartbeat auto-unwedge.

### 8. Quality vs cost knob (`lib/arena/llm/client.ts`)

Default stays `reasoningEffort: 'minimal'` (proven valid). If multi-action reads need
more thought, A/B `'low'` (~9x per-call cost, still well under the old gpt-5 default).
Per-bot override possible via the registry.

## Data flow (one tick, one bot)

```
crank (every ~2s, all markets) ── folds Lazer price → candles, runs stop/liq/funding
worker tick (every ~60s):
  read bot state (all markets) ─► build brief (all majors + full book)
    ─► 1 LLM call ─► actions[] ─► per action: floor precheck ─► apply_decision(marketId, feed)
    ─► persist N rows
```

## Asset list

BTC, ETH, SOL (live), + BNB, XRP, DOGE. All are on Hyperliquid (candles via `getCandles`)
and Pyth Lazer (live price). Markets 0–5 of the 8 available. Final set trimmed to whatever
has a working oracle feed (Dependencies).

## Dependencies to verify in the plan

1. **MagicBlock `pricing_oracle` feed PDA per asset.** The SOL PDA is `ENYweb…`. Obtain
   (or derive) the BTC/ETH/BNB/XRP/DOGE PDAs from MagicBlock's oracle and confirm each
   reads fresh via the `_spike-oracle-read` probe on the mainnet ER.
   **Fallback:** self-publish a feed account from the existing Lazer relay
   (`lib/flash/lazer-relay.ts`, feed ids in `lib/flash/live-prices.ts`) in the
   price@73/ts@93 layout — a small publisher process alongside the crank.
2. **Lazer feed ids** for BNB/XRP/DOGE (BTC=1/ETH=2/SOL=6 known) for the brief's live mark
   and any self-published feed.
3. Candle coverage for the chosen majors (Hyperliquid lists all; confirm symbols).

## Cost

- **LLM:** unchanged — 1 call/bot/tick (the array is one response). The 92% saving holds.
- **On-chain:** more `apply_decision` txs (one per action) at ~$0.001 ER fee each; the
  crank cost scales with market count (still cents/day). Negligible vs the LLM line.

## Risk & guardrails

Multi-action + higher leverage + zero cooldown is intentionally more degen and will draw
down faster. Paper money. Bounded by: `dailyLossLimitBps` kill-switch (auto-halt for the
day), per-position stop/liq enforced by the crank, `maxStakeFracBps` size cap,
`maxTradesPerDay`, and the daily heartbeat that auto-clears a stale halt.

## Testing

TDD, mirroring existing arena tests:
- `schema.test.ts`: the actions array (bounds, empty = hold, per-action validation).
- `floor.test.ts`: `evaluateActions` returns one outcome per action; parity with
  `paper_llm.rs` cases; CLOSE cooldown-exempt; cap clamps.
- `loop.test.ts`: `runBotDecision` submits one tx per surviving action, routed to the
  right market; heartbeat gate still fires first; halted/cooldown still gate opens.
- `brief.test.ts`: multi-asset book renders asset labels; market block covers all majors.
- `markets.test.ts`: the `ASSET_MARKETS` map is complete + consistent (asset↔marketId↔feed).
- On-chain market setup verified with probes (`_probe-llm-bot-state`, `_spike-oracle-read`)
  against the mainnet ER, not unit tests.

## Rollout

1. Land the off-chain code (schema/floor/loop/worker/brief/markets) behind the existing
   roster; bots keep trading SOL until markets exist.
2. Confirm feed PDAs; `init-markets.ts` to `init_market` + `delegate_market` each asset on
   mainnet; point the crank `FEEDS`/`listMarkets` at them; verify candles fold in.
3. `npm run arena:tune` (cooldown 0, leverage up, trades/day up).
4. Deploy the worker (`railway up -s arena-llm-operator`); verify multi-asset, multi-action
   trades land on the right markets.
