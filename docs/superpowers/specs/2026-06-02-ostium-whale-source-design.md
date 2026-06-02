# New whale source: Ostium (+ Hyperliquid HIP-3) — design

- **Date:** 2026-06-02
- **Status:** Approved in brainstorm. Implementing **Phase 1 (Ostium)** first, then **Phase 2 (HL HIP-3)**.
- **Owner:** whale-signals

## Problem

The Pulse/Live tape is starved of signals in the TradFi-style Flash markets — **gold, silver, oil, FX, equities, S&P** — and thin in some crypto (notably **HYPE**). Root cause: both existing whale sources (**Hyperliquid**, **Pacifica**) are crypto-perp venues that don't list those markets at all, and discovery ranks whales by **total account equity**, which buries anyone not hoarding BTC/ETH/SOL. The recent "show all markets" + "holding cards" work made every position we *have* visible; this work adds the positions we don't have yet.

## Goal

Add a **read-only** whale source that surfaces real whale positions across the starved Flash markets, feeding the **existing** tape pipeline (`whales` + `whale_positions` → `buildWhalePositionSignals` → Pulse/Live). Non-tailable markets already render as **"Watch only"**, so no UI change is required.

- **Phase 1: Ostium** — RWA perp DEX on Arbitrum. Public subgraph, covers most starved markets.
- **Phase 2: Hyperliquid HIP-3** — builder-deployed equity/commodity/S&P markets (Trade.xyz), reusing existing HL infra.

## Non-goals

- **Tailing/execution** of the new markets. They stay "Watch only" until the separate Pacifica/Flash execution unlock. This spec is about *signal density*, not execution.
- **NATGAS, USDCNH, ZEC**, and Solana memes/alts (BONK, PENGU, PUMP, WIF, FARTCOIN, ORE, JUP, PYTH, JTO, KMNO, MEGA) — Ostium doesn't list them; they remain HL/Pacifica's job.
- **New DB tables** or any refactor of the source abstraction. Ostium plugs into the existing pattern.

## Source: Ostium

- **Mainnet subgraph (Ormi, public, no auth header):**
  `https://api.subgraph.ormilabs.com/api/public/67a599d5-c8d2-4cc4-9c4d-2975a97bc5d8/subgraphs/ost-prod/live/gn`
  (Testnet: `.../subgraphs/ost-sep/live/gn`.) Stored in env `OSTIUM_SUBGRAPH_URL` with this as the default.
- `trades` entity is queryable **globally** (drop the per-trader filter the SDK uses) → discovery + positions in one query.
- `pairs` entity exposes `lastTradePrice` → current mark (no separate price API needed).
- `timestamp` is the **confirmed** open time → real fresh-open detection (better than HL's observed-time guesswork).
- Implemented in **TypeScript** via `fetch()` POST GraphQL. The Python SDK is reference only — not a dependency.

### Field scaling (decoded from live data, verified against known prices)

| field | example raw | transform | result |
|---|---|---|---|
| `collateral` | `66434263231` | ÷ 1e6 | $66,434 (USDC) |
| `leverage` | `1757` | ÷ 1e2 | 17.57× (round → int for storage) |
| `notional` | `1167250004997` | ÷ 1e6 | $1,167,250 USD notional |
| `openPrice` | `1151799999999999872` | ÷ 1e18 | 1.1518 entry |
| `pair.lastTradePrice` | `1164450000000000000` | ÷ 1e18 | 1.16445 mark |
| `timestamp` | `1762169223` | × 1000 | openedAtMs (openedAtKnown = true) |
| `isBuy` | `true` | — | side = long |

Sanity: `collateral × leverage = notional` ($66,434 × 17.57 = $1.167M ✓). Marks verified: EUR/USD 1.164, XAU 4530.6, NVDA 223.75, SPX 7592.7, HYPE 72.1.

### Flash-mapped pairs (focused scope) — Ostium pairId → from/to → Flash symbol

| group | pairId | from/to | Flash symbol | open trades (probe) |
|---|---|---|---|---|
| commodity | 5 | XAU/USD | XAU | 270 |
| commodity | 8 | XAG/USD | XAG | 166 |
| commodity | 7 | CL/USD | CRUDEOIL | 192 |
| forex | 2 | EUR/USD | EUR | 79 |
| forex | 3 | GBP/USD | GBP | 13 |
| forex | 4 | USD/JPY | USDJPY | 118 |
| index | 10 | SPX/USD | SPY | 274 |
| stock | 18 | NVDA/USD | NVDA | 84 |
| stock | 20 | AMZN/USD | AMZN | 38 |
| stock | 22 | TSLA/USD | TSLA | 40 |
| stock | 23 | AAPL/USD | AAPL | 18 |
| stock | 45 | AMD/USD | AMD | 58 |
| crypto | 0 | BTC/USD | BTC | 224 |
| crypto | 1 | ETH/USD | ETH | 73 |
| crypto | 9 | SOL/USD | SOL | 53 |
| crypto | 38 | BNB/USD | BNB | 13 |
| crypto | 41 | HYPE/USD | HYPE | 44 |

17 pairs. FX direction rule: `to == "USD"` → use `from` (EUR, GBP); `from == "USD"` → `from+to` (USDJPY). Index alias SPX → SPY. Crypto majors included because the wallets are distinct from HL/Pacifica (Arbitrum) and add HYPE/BNB density; capped per-market so they don't flood.

**Flash markets with no usable Ostium source** (documented, not silently dropped): NATGAS (only a 0-trade UNG ETF), USDCNH (no CNH pair), ZEC, and all Solana memes/alts.

### Discovery = per-market top-N (not global sort)

The live data shows a global `orderBy: tradeNotional` is dominated by a few mega EUR / USD-CAD FX positions — the same "ranking buries the rest" failure we just fixed on the tape. So discovery issues **one aliased GraphQL query** with a sub-query per mapped pair:

```graphql
query Discover {
  p5:  trades(first: 15, orderBy: tradeNotional, orderDirection: desc, where: { isOpen: true, pair: "5" })  { ...TradeFields }
  p2:  trades(first: 15, orderBy: tradeNotional, orderDirection: desc, where: { isOpen: true, pair: "2" })  { ...TradeFields }
  # ... one alias per mapped pairId
}
```

→ up to ~255 positions, **top whales guaranteed per market**. Per-market cap is env-tunable (`OSTIUM_TOP_PER_MARKET`, default 15).

### PnL

```
mark   = pair.lastTradePrice / 1e18
entry  = openPrice / 1e18
dir    = isBuy ? +1 : -1
notionalUsd        = notional / 1e6
unrealizedPnlPct   = (mark - entry) / entry * leverage * dir * 100   // on collateral
currentMark        = mark
```

If a pair has no/zero `lastTradePrice`, `currentMark` and `unrealizedPnlPct` fall back to `null` (the holding-card path already renders "P/L unavailable" — never a fake `+$0`).

## Components (mirror the existing per-source pattern)

| file | responsibility |
|---|---|
| `lib/whales/ostium-markets.ts` | `OSTIUM_SUBGRAPH_URL`, pairId↔Flash-symbol map, mapped pairId list, FX/index direction rules. |
| `lib/whales/ostium-source.ts` | `mapOstiumTrade(rawTrade, pair, nowMs)` → `WhalePositionRecord`. Pure, unit-tested. |
| `lib/whales/ostium-subgraph.ts` | `fetchOstiumPairs()`, `fetchOstiumTopTradesByMarket(pairIds, perMarket)` — `fetch()` POST GraphQL, ~10s timeout, throws on transport error (caller catches). |
| `lib/whales/refresh-ostium.ts` | `refreshOstiumWhales()`: fetch pairs (marks) + per-market trades → map → `upsertWhalePosition` → mark-missing-closed (grace window) → `writeWhaleLiveSnapshot`. Returns `{ whalesSeen, positionsSeen }`. |
| `lib/whales/refresh.ts` | add `refreshOstiumWhales()` to the `Promise.allSettled` fan-out. |
| `lib/whales/types.ts` | `WhaleSource |= "ostium"`. |
| `scripts/refresh-ostium.ts` + `package.json` `refresh:ostium` | manual runner (`tsx --env-file=.env.local`) for seed/verify, matching existing `refresh:*`. |

Identity (via existing `lib/whales/identity.ts` conventions): `positionId = "ostium:<tradeID>"`, `whaleId = "ostium:<trader>"`, `displayName = "OST 0x…<last4>"`, `sourceAccount = <trader>`.

## Reused infrastructure (unchanged)

`whales` + `whale_positions` tables, `upsertWhalePosition`, `live-cache` snapshot merge, `isSourceFresh`, `buildWhalePositionSignals` (live route already passes `includeNonCopyable: true`), `pulse-items` holding cards, and `isFlashCopyableMarket` (XAU/XAG/CRUDEOIL/EUR/GBP/USDJPY/SPY/NVDA/AMZN/TSLA/AAPL/AMD/HYPE/BNB are already in the Flash map, so these positions are correctly tagged copyable/Watch-only).

## Error handling / resilience

- `refreshOstiumWhales()` is one arm of `Promise.allSettled` — an Ostium outage degrades gracefully; HL/Pacifica are unaffected.
- Subgraph fetch: ~10s timeout, try/catch; on failure log + return `{whalesSeen:0, positionsSeen:0}` (never throw up into the loop).
- Zero/missing `lastTradePrice` → null mark/PnL, no crash.
- Query only requests mapped pairIds; any unexpected market is skipped defensively.
- Cost: 2 HTTP requests per refresh; per-market cap bounds payload size.

## Testing (TDD — write tests first)

- `lib/whales/ostium-source.test.ts` — scaling (collateral/leverage/notional/price), side, symbol via map, PnL sign+magnitude, `openedAtKnown`, fresh vs aged, null-price fallback. Golden fixture = the probed EUR $1.167M row.
- `lib/whales/ostium-markets.test.ts` — pairId→Flash symbol for every mapped pair; unmapped → null; FX direction (USD/JPY→USDJPY, EUR/USD→EUR); index alias (SPX→SPY).
- `lib/whales/refresh-ostium.test.ts` — mocked subgraph fetch → asserts `upsertWhalePosition` called with mapped records, close-missing logic runs, graceful empty return on fetch error.
- Extend the whale-refresh contract test so `refreshWhales()` includes the Ostium arm.

## Phase 2 — Hyperliquid HIP-3 (after Phase 1 ships)

Reuse the existing HL client:
1. `perpDexs` → enumerate builder dexs; identify Trade.xyz's dex name.
2. `meta { dex }` per builder dex → asset universe + max leverage.
3. For each tracked account, `clearinghouseState { user, dex: "ALL_DEXES" }` → native **and** builder-market positions in a single call.
4. Map builder symbols (NVDA, TSLA, AMZN, GOOGL, gold, silver, crude, Brent, S&P500) → Flash via the existing `FLASH_MARKET_ALIASES` table.
5. Discovery: existing HL leaderboard accounts + `ALL_DEXES` already surface their HIP-3 positions; a HIP-3-specific discovery pass is a later enhancement.

This phase gets its own implementation step after Ostium is verified in prod.

## Risks / open items

- Ostium leverage is fractional (17.57); the `whale_positions.leverage` column is integer → round for storage. PnL uses notional, so rounding doesn't affect PnL.
- `lastTradePrice` can be stale on thin pairs → null PnL fallback (acceptable).
- The subgraph's public key lives in the URL; if Ostium rotates it, update `OSTIUM_SUBGRAPH_URL`.
- Wallet identity: Ostium account = Arbitrum EVM address, distinct from HL EVM and Pacifica Solana → naturally deduped by `(source, sourceAccount)`; no collision risk.

## Rollout

1. Build + unit tests green (`npm run typecheck && npm test`).
2. Verify locally via `npm run refresh:ostium` (counts) + a DB row check + a tape probe.
3. `railway up` to prod; confirm Ostium rows in `whale_positions` and new RWA cards on the tape.
4. Then start Phase 2 (HL HIP-3).
