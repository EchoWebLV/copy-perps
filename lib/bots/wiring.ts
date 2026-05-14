// lib/bots/wiring.ts
//
// Static wiring metadata per strategy family. Surfaced by /admin/bots so an
// operator can see, without reading code, exactly which external APIs and
// files power each bot, plus what each config knob does. Variants
// (e.g. liquidation-lizard-jr) inherit their parent family's wiring.

export interface DataSource {
  label: string;
  purpose: string;
  endpoint?: string;
  file: string;
  refreshHint: string;
}

export interface ConfigKnob {
  key: string;
  type: "number" | "string" | "ms";
  purpose: string;
}

export interface StrategyWiring {
  family: string;
  displayName: string;
  description: string;
  dataSources: DataSource[];
  strategyFile: string;
  personaFile: string;
  testFile: string;
  configKnobs: ConfigKnob[];
}

const HL_MARKS: DataSource = {
  label: "Hyperliquid allMids",
  purpose:
    "Live perpetual mark price for every supported asset. Used for entry decisions, live P&L, and exit checks.",
  endpoint: "POST https://api.hyperliquid.xyz/info { type: 'allMids' }",
  file: "lib/data/marks.ts",
  refreshHint: "5s in-memory cache, refreshed every resolver tick.",
};

const HL_LIQUIDATIONS: DataSource = {
  label: "Hyperliquid userFillsByTime (curated whales)",
  purpose:
    "Liquidation events on Hyperliquid for BTC/ETH/SOL — used as fade triggers (long liq → go long).",
  endpoint:
    "POST https://api.hyperliquid.xyz/info { type: 'userFillsByTime', user: <whale> }",
  file: "lib/hyperliquid/client.ts (getRecentLiquidations)",
  refreshHint:
    "Per-whale poll every 5s, 2-min rolling buffer. Phase 2 upgrades to WS for market-wide coverage.",
};

const MULTI_CEX_FUNDING: DataSource = {
  label: "Multi-CEX funding (Binance + Bybit + OKX + dYdX)",
  purpose:
    "Per-asset funding aggregated across 4 venues. Signal includes avg rate + count of venues agreeing on direction. Fires only when ≥N venues agree, filtering out single-venue outliers.",
  endpoint:
    "Binance fapi · Bybit v5 tickers · OKX funding-rate (per asset) · dYdX v4 perpetualMarkets",
  file: "lib/data/cex-funding.ts",
  refreshHint:
    "30s cache, parallel fetch via Promise.allSettled (one venue failing degrades gracefully).",
};

const HL_CANDLES: DataSource = {
  label: "Hyperliquid candleSnapshot",
  purpose:
    "OHLCV candles per (asset, timeframe). Powers z-score, EMA, breakout, and realized-vol math.",
  endpoint:
    "POST https://api.hyperliquid.xyz/info { type: 'candleSnapshot', req: { coin, interval, ... } }",
  file: "lib/data/candles.ts",
  refreshHint: "30s cache keyed by (asset, timeframe, count).",
};

const REGIME_CLASSIFIER: DataSource = {
  label: "Regime classifier (xAI)",
  purpose:
    "Per-asset market regime label (trending-up/down, mean-reverting, vol-expanding, chop). Strategies skip entries that don't match their declared regimes, fail-open when xAI is unavailable.",
  endpoint: "xAI Grok (grok-4.20-non-reasoning) — see lib/bots/regime.ts",
  file: "lib/bots/regime.ts",
  refreshHint: "60s per-asset cache; null on xAI error (strategy fires normally).",
};

const CROSS_BOT_STATE: DataSource = {
  label: "Cross-bot state",
  purpose:
    "Snapshot of all bots' currently-open positions, grouped by (asset, side). Used by the resolver to prevent more than MAX_BOTS_SAME_SIDE bots piling into the same trade, and by the feed UI to surface disagreement between bots holding opposite sides of the same asset.",
  endpoint: "Internal DB read (paper_positions WHERE status='open')",
  file: "lib/bots/cross-bot.ts",
  refreshHint: "5s cache, refreshed each resolver tick and each feed-pool render.",
};

export const STRATEGY_FAMILIES: StrategyWiring[] = [
  {
    family: "liquidation-lizard",
    displayName: "Liquidation Lizard",
    description:
      "Fades large Hyperliquid liquidations: when a long gets force-closed, go long (and vice versa). Fast scalp out on a small favorable move or short timeout.",
    dataSources: [HL_MARKS, HL_LIQUIDATIONS, CROSS_BOT_STATE],
    strategyFile: "lib/bots/strategies/liquidation-lizard.ts",
    personaFile: "lib/bots/personas/liquidation-lizard.ts",
    testFile: "lib/bots/strategies/liquidation-lizard.test.ts",
    configKnobs: [
      {
        key: "minLiqNotionalUsd",
        type: "number",
        purpose: "Ignore liquidation fills below this $ notional.",
      },
      {
        key: "exitFavorablePct",
        type: "number",
        purpose:
          "Exit when price moves this fraction in our favor (e.g. 0.005 = 0.5%).",
      },
      { key: "maxHoldMs", type: "ms", purpose: "Force-close after this many ms regardless." },
      { key: "leverage", type: "number", purpose: "Leverage multiplier on the paper position." },
    ],
  },
  {
    family: "funding-phoebe",
    displayName: "Funding Phoebe",
    description:
      "Fades funding-rate extremes — positive funding (longs paying) → short; negative funding → long. Multi-hour hold for the funding cycle to swing back.",
    dataSources: [HL_MARKS, MULTI_CEX_FUNDING, CROSS_BOT_STATE],
    strategyFile: "lib/bots/strategies/funding-phoebe.ts",
    personaFile: "lib/bots/personas/funding-phoebe.ts",
    testFile: "lib/bots/strategies/funding-phoebe.test.ts",
    configKnobs: [
      {
        key: "fundingThreshold",
        type: "number",
        purpose: "Minimum |funding| to fire (e.g. 0.0001 = 1bp/period).",
      },
      {
        key: "minVenueAgreement",
        type: "number",
        purpose:
          "Minimum number of CEX venues that must agree on funding direction before firing. Filters single-venue outliers.",
      },
      { key: "exitFavorablePct", type: "number", purpose: "Favorable price move to exit on." },
      { key: "maxHoldMs", type: "ms", purpose: "Max hold time in ms." },
      { key: "leverage", type: "number", purpose: "Leverage multiplier." },
    ],
  },
  {
    family: "mean-revert-mike",
    displayName: "Mean-Revert Mike",
    description:
      "Computes a z-score of price against the recent candle window. When price is too far from mean (|z| > threshold), fade in the opposite direction.",
    dataSources: [HL_MARKS, HL_CANDLES, REGIME_CLASSIFIER, CROSS_BOT_STATE],
    strategyFile: "lib/bots/strategies/mean-revert-mike.ts",
    personaFile: "lib/bots/personas/mean-revert-mike.ts",
    testFile: "lib/bots/strategies/mean-revert-mike.test.ts",
    configKnobs: [
      { key: "timeframe", type: "string", purpose: "Candle timeframe (e.g. '1m', '1h')." },
      { key: "candleCount", type: "number", purpose: "Window length for the z-score calc." },
      { key: "zEntryThreshold", type: "number", purpose: "Absolute z-score required to fire." },
      { key: "exitFavorablePct", type: "number", purpose: "Favorable move to exit." },
      { key: "maxHoldMs", type: "ms", purpose: "Max hold ms." },
      { key: "leverage", type: "number", purpose: "Leverage multiplier." },
      {
        key: "regimesAllowed",
        type: "string",
        purpose:
          "Comma-separated list of regime labels the strategy is allowed to fire in (e.g. 'mean-reverting,chop'). Empty array disables the regime gate.",
      },
    ],
  },
  {
    family: "momo-max",
    displayName: "Momo Max",
    description:
      "Breakout chaser: enters when a candle's body exceeds a threshold AND volume spikes vs. recent average. Direction follows the candle.",
    dataSources: [HL_MARKS, HL_CANDLES, REGIME_CLASSIFIER, CROSS_BOT_STATE],
    strategyFile: "lib/bots/strategies/momo-max.ts",
    personaFile: "lib/bots/personas/momo-max.ts",
    testFile: "lib/bots/strategies/momo-max.test.ts",
    configKnobs: [
      { key: "timeframe", type: "string", purpose: "Candle timeframe (e.g. '5m')." },
      { key: "candleCount", type: "number", purpose: "Window for the volume baseline." },
      { key: "breakoutPct", type: "number", purpose: "Min body |close − open| / open." },
      {
        key: "volumeMultiplier",
        type: "number",
        purpose: "Last candle volume must exceed mean × this multiplier.",
      },
      { key: "exitFavorablePct", type: "number", purpose: "Favorable move to exit." },
      { key: "maxHoldMs", type: "ms", purpose: "Max hold ms." },
      { key: "leverage", type: "number", purpose: "Leverage multiplier." },
      {
        key: "regimesAllowed",
        type: "string",
        purpose:
          "Comma-separated list of regime labels the strategy is allowed to fire in (e.g. 'mean-reverting,chop'). Empty array disables the regime gate.",
      },
    ],
  },
  {
    family: "vol-vector",
    displayName: "Vol Vector",
    description:
      "Realized-vol spike detector. Compares recent (1m) realized vol to a longer baseline (1h); on a spike + directionally-consistent candles, enters that direction.",
    dataSources: [HL_MARKS, HL_CANDLES, REGIME_CLASSIFIER, CROSS_BOT_STATE],
    strategyFile: "lib/bots/strategies/vol-vector.ts",
    personaFile: "lib/bots/personas/vol-vector.ts",
    testFile: "lib/bots/strategies/vol-vector.test.ts",
    configKnobs: [
      { key: "recentTimeframe", type: "string", purpose: "Recent window timeframe (e.g. '1m')." },
      { key: "recentCount", type: "number", purpose: "Recent window length." },
      { key: "baselineTimeframe", type: "string", purpose: "Baseline timeframe." },
      { key: "baselineCount", type: "number", purpose: "Baseline window length." },
      { key: "volMultiplier", type: "number", purpose: "Recent / baseline RV must exceed this." },
      {
        key: "trendConsistencyMin",
        type: "number",
        purpose: "Min fraction of candles agreeing with the chosen direction.",
      },
      { key: "exitFavorablePct", type: "number", purpose: "Favorable move to exit." },
      { key: "maxHoldMs", type: "ms", purpose: "Max hold ms." },
      { key: "leverage", type: "number", purpose: "Leverage multiplier." },
      {
        key: "regimesAllowed",
        type: "string",
        purpose:
          "Comma-separated list of regime labels the strategy is allowed to fire in (e.g. 'mean-reverting,chop'). Empty array disables the regime gate.",
      },
    ],
  },
  {
    family: "boomer-trend",
    displayName: "Boomer Trend",
    description:
      "Slow trend follower on 4h candles. EMA(fast) crossing above EMA(slow) goes long; cross below goes short. Multi-day holds, low leverage.",
    dataSources: [HL_MARKS, HL_CANDLES, REGIME_CLASSIFIER, CROSS_BOT_STATE],
    strategyFile: "lib/bots/strategies/boomer-trend.ts",
    personaFile: "lib/bots/personas/boomer-trend.ts",
    testFile: "lib/bots/strategies/boomer-trend.test.ts",
    configKnobs: [
      { key: "timeframe", type: "string", purpose: "Candle timeframe (e.g. '4h')." },
      { key: "candleCount", type: "number", purpose: "Window length for the EMAs." },
      { key: "fastPeriod", type: "number", purpose: "EMA-fast period." },
      { key: "slowPeriod", type: "number", purpose: "EMA-slow period." },
      { key: "exitFavorablePct", type: "number", purpose: "Favorable move to exit." },
      { key: "maxHoldMs", type: "ms", purpose: "Max hold ms." },
      { key: "leverage", type: "number", purpose: "Leverage multiplier." },
      {
        key: "regimesAllowed",
        type: "string",
        purpose:
          "Comma-separated list of regime labels the strategy is allowed to fire in (e.g. 'mean-reverting,chop'). Empty array disables the regime gate.",
      },
    ],
  },
];

const FAMILY_BY_KEY = new Map(STRATEGY_FAMILIES.map((f) => [f.family, f]));

/**
 * Returns the wiring metadata for a given strategyKey. Matches the family
 * directly, then falls back to a prefix match for variants (e.g.
 * "liquidation-lizard-jr" → liquidation-lizard).
 */
export function getStrategyWiring(strategyKey: string): StrategyWiring | null {
  const direct = FAMILY_BY_KEY.get(strategyKey);
  if (direct) return direct;
  for (const family of STRATEGY_FAMILIES) {
    if (strategyKey.startsWith(family.family + "-")) return family;
  }
  return null;
}

export function listStrategyFamilies(): StrategyWiring[] {
  return STRATEGY_FAMILIES.slice();
}

/**
 * Map a strategyKey to its family name. Used when registering DB-loaded
 * bots so the factory map knows which strategy constructor to call.
 */
export function familyOf(strategyKey: string): string | null {
  const wiring = getStrategyWiring(strategyKey);
  return wiring?.family ?? null;
}
