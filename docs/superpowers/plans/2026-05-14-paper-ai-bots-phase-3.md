# Paper AI Bots — Phase 3 Implementation Plan

> Subagent-driven execution. Steps use checkbox (`- [ ]`).

**Goal:** Three independent feature drops that meaningfully raise bot quality and feed narrative without touching anything user-facing in the trade-execution path: multi-CEX funding aggregation (Funding Phoebe), regime classifier (Mean-Revert Mike + Momo Max + Vol Vector + Boomer Trend), cross-bot awareness (all bots, pileup prevention + disagreement linking).

**Architecture:** Three additive features, each shippable on its own. Each feature touches: (1) one or more strategy files, (2) `lib/data/` or `lib/bots/` for a new helper module, (3) `lib/bots/wiring.ts` so the admin panel reflects the new data source / config knob, (4) tests. Cross-bot also touches BotSignal payload + BotCard for the disagreement-link UX.

**Branch:** Continuing on `paper-bots-phase-1`.

**Out of scope (Phase 4+):** Helius webhooks, Pyth oracles, order-book microstructure, backtest gate, weekly dossier cron, busted-bot revival, dedicated Live Feed tab, bot detail page polish.

---

## Feature A — Multi-CEX funding (1 bot family)

Replaces single-venue Binance fetch with a 4-venue aggregator. Funding Phoebe fires only when ≥N venues agree on direction with above-threshold magnitude.

### Task A1 — Refactor `lib/data/cex-funding.ts`

**Goal:** Aggregate Binance + Bybit + OKX + dYdX funding rates per asset, return both averaged rate AND agreement count (how many venues agree on sign).

**Files:**
- Modify: `lib/data/cex-funding.ts`
- Modify: `lib/bots/types.ts` (widen `ExternalSignals.funding` to carry agreement info)

**New return shape (replaces flat `Record<string, number>`):**

```ts
export interface FundingSignal {
  avgRate: number;        // average of contributing venues
  venuesAgreed: number;   // count of venues with same sign as avgRate
  venuesQueried: number;  // total venues that responded (may be < 4 on outages)
  perVenue: Record<string, number>; // for debugging / admin display
}

export async function getFundingRates(): Promise<Record<string, FundingSignal>>;
```

**ExternalSignals in `lib/bots/types.ts`:**

```ts
export interface ExternalSignals {
  liquidations: LiquidationEvent[];
  funding: Record<string, FundingSignal>; // was: Record<string, number>
}
```

**Implementation outline:**

```ts
// lib/data/cex-funding.ts

const VENUE_FETCHERS = {
  binance: fetchBinanceFunding,
  bybit: fetchBybitFunding,
  okx: fetchOkxFunding,
  dydx: fetchDydxFunding,
};

// Per-venue functions hit their public endpoints and return Record<string, number>.
// Symbol normalization map maintained per venue.

async function fetchBinanceFunding(): Promise<Record<string, number>> {
  const url = "https://fapi.binance.com/fapi/v1/premiumIndex";
  // existing logic
}

async function fetchBybitFunding(): Promise<Record<string, number>> {
  // GET https://api.bybit.com/v5/market/tickers?category=linear
  // response: { result: { list: [{ symbol: "BTCUSDT", fundingRate: "0.00012", ... }] } }
  // Normalize: trim "USDT" suffix to match internal symbols.
}

async function fetchOkxFunding(): Promise<Record<string, number>> {
  // GET https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP
  // OKX requires per-instrument calls — fan out for the 8 majors.
}

async function fetchDydxFunding(): Promise<Record<string, number>> {
  // GET https://indexer.dydx.trade/v4/perpetualMarkets
  // response: { markets: { "BTC-USD": { nextFundingRate: "0.0001", ... }, ... } }
}

// In getFundingRates, fetch all venues in parallel, build per-asset signal:
// avgRate = mean of contributing venues; venuesAgreed = count with same sign as avgRate.
```

**Caveats:**
- Bybit: USDT-perp symbols (BTCUSDT). Trim "USDT".
- OKX: SWAP suffix and dash separator (BTC-USDT-SWAP). Fan-out per asset; rate-limited.
- dYdX: uses USD pairs (BTC-USD) and may report `nextFundingRate` (per-period). Match the format of the other three.
- Failure tolerance: if a venue errors, omit it from `perVenue` but still compute avg + agreement from the rest. Don't throw.

Cache 30s as before.

**Tests** (`lib/data/cex-funding.test.ts`):
- Mock each venue fetcher; verify aggregation produces `avgRate`, `venuesAgreed`, `venuesQueried`.
- One-venue-error case: 3 succeed, 1 errors; signal still emits with `venuesQueried: 3`.
- Disagreement case: 2 positive, 2 negative; avgRate near 0, venuesAgreed = 2.

**Verification:** Probe each endpoint via `curl` to confirm response shapes BEFORE implementing the fetcher (Bybit, OKX, dYdX shapes may differ from spec).

**Commit:** `feat(data): multi-CEX funding aggregator (Binance + Bybit + OKX + dYdX)`

### Task A2 — Funding Phoebe uses venue agreement

**Files:**
- Modify: `lib/bots/strategies/funding-phoebe.ts`
- Modify: `lib/bots/strategies/funding-phoebe.test.ts`

**Strategy change:** entry triggers on `Math.abs(signal.avgRate) >= threshold && signal.venuesAgreed >= minVenueAgreement`. Default `minVenueAgreement: 3` for headliner Phoebe, `2` for Lite variant (more permissive).

**New params:**
```ts
interface PhoebeParams {
  id: string;
  fundingThreshold: number;
  minVenueAgreement: number; // NEW
  exitFavorablePct: number;
  maxHoldMs: number;
  leverage: number;
}
```

**Conviction unchanged in spirit but now uses `avgRate`:**
```ts
const conviction = clampConviction(Math.abs(signal.avgRate) / 0.0003);
```

**Test fixtures update:** signal shape changes from `{ BTC: 0.0002 }` to `{ BTC: { avgRate: 0.0002, venuesAgreed: 3, venuesQueried: 4, perVenue: {...} } }`. Update all test cases.

**Commit:** `feat(bots): Funding Phoebe gates on multi-venue agreement`

### Task A3 — Admin wiring metadata + verification

**Files:**
- Modify: `lib/bots/wiring.ts`
- Modify: `lib/bots/factories.ts` (no change expected, but verify params still flow correctly)

**Wiring change:** replace `BINANCE_FUNDING` const with `MULTI_CEX_FUNDING`:

```ts
const MULTI_CEX_FUNDING: DataSource = {
  label: "Multi-CEX funding (Binance + Bybit + OKX + dYdX)",
  purpose: "Per-asset funding aggregated across 4 venues. Fires only when ≥N venues agree on direction.",
  endpoint: "Various — see lib/data/cex-funding.ts",
  file: "lib/data/cex-funding.ts",
  refreshHint: "30s cache, parallel fetch per venue.",
};
```

Add `minVenueAgreement` config knob to Funding Phoebe's `configKnobs`:
```ts
{
  key: "minVenueAgreement",
  type: "number",
  purpose: "Minimum number of CEX venues that must agree on direction before firing.",
},
```

**Verification:**
- `npm run typecheck && npm test` — all pass.
- Start dev server, hit `/admin/bots/funding-phoebe` — confirm wiring panel shows multi-CEX, edit form shows `minVenueAgreement` knob.
- Confirm `/api/cron/bots-resolver` still completes without errors.

**Commit:** `feat(admin): multi-CEX wiring metadata + minVenueAgreement knob`

---

## Feature B — Regime classifier

xAI labels each asset's regime per minute. Strategies gate entries on regime match.

### Task B1 — `lib/bots/regime.ts` (xAI classifier + cache)

**Files:**
- Create: `lib/bots/regime.ts`
- Create: `lib/bots/regime.test.ts`

**Module shape:**

```ts
export type Regime = "trending-up" | "trending-down" | "mean-reverting" | "vol-expanding" | "chop";

export interface RegimeSnapshot {
  regime: Regime;
  confidence: number; // 0..1
  sampledAtMs: number;
}

export async function getRegime(asset: string): Promise<RegimeSnapshot | null>;
```

**Implementation:**
- Pull last 30 1m candles via `getCandles(asset, "1m", 30)`.
- Compute deterministic features: returns mean, returns stddev, abs(z-score of last close vs 30m mean), EMA-7 vs EMA-21 slope.
- Send features to xAI Grok with a structured prompt asking for one of the 5 regime labels + confidence.
- Cache 60s per asset (in-memory Map).
- On xAI error, return null — strategies treat null as "no regime info, fire normally" (fail-open).

**Prompt template:**
```
You are a deterministic market-regime classifier. Given features, output exactly one JSON object: {"regime": "<label>", "confidence": <0..1>}.

Labels:
- trending-up: sustained upward drift, momentum continues likely
- trending-down: sustained downward drift
- mean-reverting: prices oscillating around a stable mean
- vol-expanding: realized volatility recently increased, large moves likely
- chop: low vol, range-bound

Features for {asset}:
- 30m return mean: {meanReturn}
- 30m return stddev: {stddev}
- Current z-score vs 30m mean: {zScore}
- EMA7/EMA21 slope ratio: {emaRatio}

Output only valid JSON, no commentary.
```

**Tests:** mock xAI response; verify cache hit on second call; verify null on xAI error.

**Commit:** `feat(bots): xAI regime classifier with per-asset 60s cache`

### Task B2 — Regime gating in 4 strategies

**Files:**
- Modify: `lib/bots/types.ts` (add `regimesAllowed` to factory params)
- Modify: `lib/bots/strategies/mean-revert-mike.ts`
- Modify: `lib/bots/strategies/momo-max.ts`
- Modify: `lib/bots/strategies/vol-vector.ts`
- Modify: `lib/bots/strategies/boomer-trend.ts`

**Strategy changes:** each affected strategy's `evaluateEntry`:

```ts
async evaluateEntry(ctx, signals) {
  // ... existing checks ...
  if (p.regimesAllowed && p.regimesAllowed.length > 0) {
    const regime = await getRegime(ctx.asset);
    if (regime && !p.regimesAllowed.includes(regime.regime)) return null;
  }
  // ... rest of existing logic ...
}
```

**Default `regimesAllowed`:**
- Mean-Revert Mike: `["mean-reverting", "chop"]`
- Mean-Revert Mike Patient: `["mean-reverting"]` (stricter)
- Momo Max: `["trending-up", "trending-down", "vol-expanding"]`
- Momo Max Aggressive: `["trending-up", "trending-down", "vol-expanding", "chop"]` (more permissive)
- Vol Vector: `["vol-expanding"]`
- Vol Vector Hair-Trigger: `["vol-expanding", "chop"]`
- Boomer Trend: `["trending-up", "trending-down"]`
- Boomer Trend Wide: `["trending-up", "trending-down", "mean-reverting"]` (catches drift)

**Liquidation Lizard + Funding Phoebe:** unchanged. Both work across regimes.

**Test updates:** add a "skips entry when regime is wrong" test per affected strategy. Mock `getRegime` to return `{regime: "trending-up", confidence: 0.9}` and verify Mean-Revert Mike returns null.

**Commit:** `feat(bots): regime-gated entries on Mike + Momo + Vol + Boomer`

### Task B3 — Admin wiring metadata + verification

**Files:**
- Modify: `lib/bots/wiring.ts`

**Wiring change:** add `REGIME_CLASSIFIER` data source:

```ts
const REGIME_CLASSIFIER: DataSource = {
  label: "Regime classifier (xAI)",
  purpose: "Per-asset market regime label (trending/mean-reverting/vol-expanding/chop). Strategies skip entries that don't match their declared regimes.",
  endpoint: "xAI Grok (internal — see lib/bots/regime.ts)",
  file: "lib/bots/regime.ts",
  refreshHint: "60s per-asset cache.",
};
```

Add to dataSources for Mike, Momo, Vol, Boomer families.

Add `regimesAllowed` config knob (type: `string` — comma-separated list of regime labels) to each affected family.

**Verification:** same pattern — typecheck, test, dev-server probe, admin panel check.

**Commit:** `feat(admin): regime wiring metadata + regimesAllowed knob`

---

## Feature C — Cross-bot awareness

Pileup prevention (defensive) + disagreement linking (UX).

### Task C1 — `lib/bots/cross-bot.ts`

**Files:**
- Create: `lib/bots/cross-bot.ts`

**Shape:**

```ts
export interface CrossBotSnapshot {
  /** Map of (asset, side) → count of bots holding it */
  positionsByAssetSide: Map<string, number>; // key: `${asset}|${side}`
  /** Map of asset → array of bot ids currently holding it (any side) */
  botsByAsset: Map<string, Array<{ botId: string; side: "long" | "short" }>>;
}

export async function getCrossBotSnapshot(): Promise<CrossBotSnapshot>;
```

Reads all open `paper_positions` rows, groups them. Cached 5s.

### Task C2 — Pileup prevention in resolver

**Files:**
- Modify: `lib/bots/resolver.ts`

After entry decision, check pileup before opening:

```ts
const snapshot = await getCrossBotSnapshot();
const key = `${decision.asset}|${decision.side}`;
const sameSideCount = snapshot.positionsByAssetSide.get(key) ?? 0;
if (sameSideCount >= MAX_BOTS_SAME_SIDE) continue; // skip this entry
```

`MAX_BOTS_SAME_SIDE = 3` (constant in resolver).

### Task C3 — BotSignal disagreement payload

**Files:**
- Modify: `lib/types.ts` — add `disagreements` to BotSignal payload
- Modify: `lib/signals/bot-signals.ts` — compute disagreements per bot

**Shape addition:**
```ts
// inside BotSignal payload, add:
disagreements: Array<{
  botId: string;
  botName: string;
  avatarEmoji: string;
  asset: string;
  side: "long" | "short"; // the OTHER bot's side
}>;
```

For each bot's open position, find other bots holding the OPPOSITE side on the same asset. Surface them as disagreements.

### Task C4 — BotCard renders disagreement link

**Files:**
- Modify: `components/feed/BotCard.tsx`

For each position with disagreements, render a small badge: `"Mike disagrees with this trade"` (or similar).

### Task C5 — Admin wiring + verification

**Files:**
- Modify: `lib/bots/wiring.ts`

Add `CROSS_BOT_STATE` data source to all bot families (defensive — they all read it for pileup).

Add `maxBotsSameSide` resolver constant to the admin detail page's "resolver constants" panel.

**Commit:** `feat(feed): cross-bot disagreement linking on BotCard`

---

## Verification (per feature)

After each feature lands:
1. `npm run typecheck && npm test`
2. Start dev server, hit `/api/cron/bots-resolver`, confirm JSON ok
3. Browse `/feed` — confirm bots still render, balance/positions visible
4. Browse `/admin/bots` — confirm new wiring is reflected in detail panels

**No final-pass code review** unless I flag concerns mid-stream — Phase 1/2 quality patterns hold.
