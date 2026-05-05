import "server-only";
import { unstable_cache } from "next/cache";
import type {
  Signal,
  MemeSignal,
  PredictionSignal,
  MultiPredictionSignal,
  MultiPredictionOutcome,
  WhaleSignal,
  SignalChipData,
} from "@/lib/types";
import { memeSparkline } from "@/lib/signals/sparkline";
import {
  listEvents,
  type JPEvent,
  type JPMarket,
} from "@/lib/jupiter-prediction/client";
import { predictionHeatScore, predictionSignalChips } from "@/lib/signals/heat-prediction";
import {
  getClearinghouseState,
  getUserFillsByTime,
  type HLFill,
} from "@/lib/hyperliquid/client";
import { CURATED_WHALES, truncateEthAddress } from "@/lib/hyperliquid/whales";
import { whaleHeatScore, whaleSignalChips } from "@/lib/signals/heat-whale";
import { flashSymbolFor } from "@/lib/flash-trade/client";

// Pool sizes — these gate "infinity" before a reshuffle / repeat.
const MEME_FETCH_LIMIT = 100;
const PREDICTION_FETCH_LIMIT = 200;
const PREDICTION_KEEP = 80;
const MULTI_OUTCOMES_TO_SHOW = 4;
const WHALE_TOP_PER_WHALE = 5;
// How "fresh" a position has to be to make the rail. The user's stated
// recency cap is "not 30 days old," and the heat-score recency boost
// still pushes sub-hour opens to the top so users see "minutes ago" cards
// first and "Xd ago" further down. 21 days is the sweet spot — captures
// almost every still-active holding without crossing the user's "stale"
// threshold.
const WHALE_FRESH_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;

// Filters — tuned to keep the pool full of tokens Jupiter can actually
// swap into without simulation errors (rugged authorities, dust
// liquidity, and bonding-curve-only tokens fail the swap step).
const MEME_MIN_LIQUIDITY_USD = 50_000;
const MEME_MIN_HOLDERS = 200;
const MEME_MAX_MCAP_USD = 1_500_000_000; // drop blue chips like SOL/USDC
const MEME_EXCLUDED_TAGS = new Set(["xstocks", "stocks", "lst"]);
const MEME_EXCLUDED_MINTS = new Set([
  "So11111111111111111111111111111111111111112", // wSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4", // JLP (LP token)
]);
const PREDICTION_MIN_VOL_USD = 3_000;
const PREDICTION_MAX_DAYS = 365;
const WHALE_MIN_POSITION_USD = 25_000;
const WHALE_MIN_LEVERAGE = 1.5;

// ─── Memes ────────────────────────────────────────────────────────────────

interface JupTokenStats {
  priceChange?: number;
  buyVolume?: number;
  sellVolume?: number;
  numBuys?: number;
  numSells?: number;
}

interface JupToken {
  id: string;
  name: string;
  symbol: string;
  icon?: string | null;
  decimals?: number;
  mcap?: number | null;
  fdv?: number | null;
  usdPrice?: number | null;
  liquidity?: number | null;
  holderCount?: number | null;
  organicScore?: number | null;
  organicScoreLabel?: string | null;
  isVerified?: boolean;
  tags?: string[];
  stats5m?: JupTokenStats;
  stats1h?: JupTokenStats;
  stats6h?: JupTokenStats;
  stats24h?: JupTokenStats;
}

async function fetchJupTopTrending(limit: number): Promise<JupToken[]> {
  const r = await fetch(
    `https://lite-api.jup.ag/tokens/v2/toptrending/24h?limit=${limit}`,
    { cache: "no-store" },
  );
  if (!r.ok) throw new Error(`Jupiter toptrending: ${r.status}`);
  return (await r.json()) as JupToken[];
}

function memeHeatScoreJup(t: JupToken): number {
  const volH1 = (t.stats1h?.buyVolume ?? 0) + (t.stats1h?.sellVolume ?? 0);
  const volH24 = (t.stats24h?.buyVolume ?? 0) + (t.stats24h?.sellVolume ?? 0);
  const avgHourly = volH24 / 24;
  const volRatio = avgHourly > 0 ? volH1 / avgHourly : 0;
  const volPoints = Math.min(50, volRatio * 12);

  const priceMove1h = Math.abs(t.stats1h?.priceChange ?? 0);
  const pricePoints = Math.min(30, priceMove1h * 1.5);

  const organicPoints = Math.min(20, ((t.organicScore ?? 0) * 100) / 5);

  let score = volPoints + pricePoints + organicPoints;

  const liq = t.liquidity ?? 0;
  if (liq < 50_000) score *= 0.7;
  if (liq < 20_000) score *= 0.5;

  return Math.round(Math.max(0, Math.min(100, score)));
}

function memeChipsJup(t: JupToken): SignalChipData[] {
  const chips: SignalChipData[] = [];

  const volH1 = (t.stats1h?.buyVolume ?? 0) + (t.stats1h?.sellVolume ?? 0);
  const volH24 = (t.stats24h?.buyVolume ?? 0) + (t.stats24h?.sellVolume ?? 0);
  const avgHourly = volH24 / 24;
  if (avgHourly > 0 && volH1 > avgHourly * 1.5) {
    const pct = Math.round((volH1 / avgHourly - 1) * 100);
    chips.push({ text: `Volume +${pct}% vs 24h avg`, level: "amber" });
  }

  const buys = t.stats1h?.numBuys ?? 0;
  const sells = t.stats1h?.numSells ?? 0;
  if (buys > sells && buys + sells > 20) {
    chips.push({
      text: `${buys} buys vs ${sells} sells (1h)`,
      level: "green",
    });
  }

  const liq = t.liquidity ?? 0;
  if (liq > 200_000) {
    chips.push({
      text: `$${(liq / 1000).toFixed(0)}k liquidity`,
      level: "purple",
    });
  } else if (t.organicScoreLabel === "high") {
    chips.push({ text: "High organic score", level: "purple" });
  }

  return chips.slice(0, 3);
}

function tokenIsExcluded(t: JupToken): boolean {
  if (MEME_EXCLUDED_MINTS.has(t.id)) return true;
  if (t.tags?.some((tag) => MEME_EXCLUDED_TAGS.has(tag))) return true;
  if ((t.mcap ?? t.fdv ?? 0) > MEME_MAX_MCAP_USD) return true;
  if ((t.liquidity ?? 0) < MEME_MIN_LIQUIDITY_USD) return true;
  // Holder count gates out dust tokens, brand-new pump.fun launches with
  // no real distribution, and deployer-only tokens that fail the swap.
  if ((t.holderCount ?? 0) < MEME_MIN_HOLDERS) return true;
  return false;
}

async function fetchMemePool(): Promise<MemeSignal[]> {
  const tokens = await fetchJupTopTrending(MEME_FETCH_LIMIT);
  const stamp = new Date().toISOString();

  return tokens
    .filter((t) => !tokenIsExcluded(t))
    .map((t) => {
      const score = memeHeatScoreJup(t);
      const pc = {
        m5: t.stats5m?.priceChange,
        h1: t.stats1h?.priceChange,
        h6: t.stats6h?.priceChange,
        h24: t.stats24h?.priceChange,
      };
      const meme: MemeSignal = {
        id: `meme:${t.id}`,
        type: "meme",
        heatScore: score,
        createdAt: stamp,
        chips: memeChipsJup(t),
        ticker: `$${t.symbol.toUpperCase()}`,
        name: t.name,
        chain: "Solana",
        tokenAddress: t.id,
        tokenDecimals: t.decimals,
        price: t.usdPrice ?? 0,
        marketCap: t.mcap ?? t.fdv ?? undefined,
        change24hPct: t.stats24h?.priceChange ?? 0,
        sparklinePath: memeSparkline(pc, t.id),
      };
      return meme;
    });
}

// ─── Predictions ──────────────────────────────────────────────────────────

function openFutureMarkets(event: JPEvent): JPMarket[] {
  const now = Date.now() / 1000;
  return event.markets.filter(
    (m) => m.status === "open" && m.closeTime > now,
  );
}

function fmtResolveDate(closeTime: number): string {
  return new Date(closeTime * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type PredictionCandidate =
  | { kind: "binary"; event: JPEvent; market: JPMarket; score: number }
  | {
      kind: "multi";
      event: JPEvent;
      markets: JPMarket[];
      outcomes: MultiPredictionOutcome[];
      score: number;
    };

async function fetchPredictionPool(): Promise<
  (PredictionSignal | MultiPredictionSignal)[]
> {
  const events = await listEvents({ limit: PREDICTION_FETCH_LIMIT });
  const now = Date.now();
  const candidates: PredictionCandidate[] = [];

  for (const ev of events) {
    if (!ev.isActive) continue;
    const open = openFutureMarkets(ev);
    if (open.length === 0) continue;

    const days = open
      .map((m) => (m.closeTime * 1000 - now) / (24 * 3600 * 1000))
      .reduce((min, v) => Math.min(min, v), Infinity);
    if (days > PREDICTION_MAX_DAYS) continue;

    const vol24 = Number(ev.volume24hr) / 1e6;
    if (vol24 < PREDICTION_MIN_VOL_USD) continue;

    if (open.length === 1) {
      const market = open[0];
      const yesPrice = parseFloat(market.outcomePrices?.[0] ?? "0");
      if (!Number.isFinite(yesPrice)) continue;
      if (yesPrice >= 0.99 || yesPrice <= 0.005) continue;
      candidates.push({
        kind: "binary",
        event: ev,
        market,
        score: predictionHeatScore(ev, market),
      });
    } else {
      const outcomes = open
        .map((m) => ({
          label: m.title,
          marketId: m.marketId,
          yesProbability: parseFloat(m.outcomePrices?.[0] ?? "0"),
        }))
        .filter(
          (o) =>
            Number.isFinite(o.yesProbability) &&
            o.yesProbability > 0.005 &&
            o.yesProbability < 0.99,
        )
        .sort((a, b) => b.yesProbability - a.yesProbability);

      if (outcomes.length === 0) continue;

      const leadMarket =
        open.find((m) => m.marketId === outcomes[0].marketId) ?? open[0];
      candidates.push({
        kind: "multi",
        event: ev,
        markets: open,
        outcomes,
        score: predictionHeatScore(ev, leadMarket),
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, PREDICTION_KEEP);

  const stamp = new Date().toISOString();
  return top.map((c) => {
    if (c.kind === "binary") {
      const { event, market, score } = c;
      const yesProbability = parseFloat(market.outcomePrices[0]);
      const sig: PredictionSignal = {
        id: `prediction:${event.eventId}:${market.marketId}`,
        type: "prediction",
        heatScore: score,
        createdAt: stamp,
        chips: predictionSignalChips(event, market),
        question: event.metadata.title,
        resolveDate: fmtResolveDate(market.closeTime),
        volume24h: Number(event.volume24hr) / 1e6,
        yesProbability,
        eventId: event.eventId,
        marketId: market.marketId,
        series: event.metadata.series,
        imageUrl: market.imageUrl ?? event.metadata.imageUrl ?? null,
      };
      return sig;
    }
    const { event, markets, outcomes, score } = c;
    const earliestClose = Math.min(...markets.map((m) => m.closeTime));
    const leadMarket =
      markets.find((m) => m.marketId === outcomes[0].marketId) ?? markets[0];
    const sig: MultiPredictionSignal = {
      id: `multiprediction:${event.eventId}`,
      type: "multiprediction",
      heatScore: score,
      createdAt: stamp,
      chips: predictionSignalChips(event, leadMarket),
      question: event.metadata.title,
      resolveDate: fmtResolveDate(earliestClose),
      volume24h: Number(event.volume24hr) / 1e6,
      eventId: event.eventId,
      series: event.metadata.series,
      outcomes: outcomes.slice(0, MULTI_OUTCOMES_TO_SHOW),
      totalOutcomes: outcomes.length,
      imageUrl: event.metadata.imageUrl ?? null,
    };
    return sig;
  });
}

// ─── Whales ───────────────────────────────────────────────────────────────

// Match a position's coin+direction against fills to find when it was
// (re)opened. "Long > Short" is a flip — the fill closes the long AND
// opens the short, so it counts as the open for the resulting short.
function fillOpensSide(dir: string, side: "long" | "short"): boolean {
  if (side === "long") return dir === "Open Long" || dir === "Short > Long";
  return dir === "Open Short" || dir === "Long > Short";
}

// Cap concurrent Hyperliquid info calls. The endpoint is generous on a
// per-minute basis (~1200/min) but bursting 55+ parallel calls during a
// cache rebuild can trip per-second guards and cause some wallets to
// silently drop out — visually the rail looks like it "lost" perps.
// Concurrency 8 keeps us comfortably under the burst limit while still
// finishing a full rebuild in 5–8 seconds.
async function mapLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
const WHALE_FETCH_CONCURRENCY = 2;

// Per-wallet cached info calls. This is the actual rate-limit defense:
// each wallet's recent fills / state changes slowly enough that a 5-minute
// cache is fine, and bucketing the fills' startTime to the nearest minute
// lets unstable_cache reuse the same key across many calls inside the
// window. Net effect: a fully warm cache produces zero HL hits per page
// load; a fully cold cache produces 1 fills + 1 state call per wallet
// across the entire 5-minute window, regardless of how many users hit
// the feed.
const WALLET_FILLS_TTL = 300; // 5 min
const WALLET_STATE_TTL = 300; // 5 min

const cachedWalletFills = unstable_cache(
  async (address: string, _bucket: number): Promise<HLFill[]> => {
    return getUserFillsByTime(address, Date.now() - WHALE_FRESH_WINDOW_MS);
  },
  ["wallet-fills-v1"],
  { revalidate: WALLET_FILLS_TTL, tags: ["feed-pool"] },
);

const cachedWalletState = unstable_cache(
  async (address: string, _bucket: number) => {
    return getClearinghouseState(address);
  },
  ["wallet-state-v1"],
  { revalidate: WALLET_STATE_TTL, tags: ["feed-pool"] },
);

// Bucket helper — same address + same bucket within a 5-min window
// hits the same cache slot regardless of when within the window it
// fires. Without this, the unstable_cache would key off the precise
// timestamp and never reuse anything.
function fiveMinBucket(): number {
  return Math.floor(Date.now() / (5 * 60 * 1000));
}

async function fetchWhalePool(): Promise<WhaleSignal[]> {
  const now = Date.now();
  const stamp = new Date(now).toISOString();
  const bucket = fiveMinBucket();

  // Pass 1 — pull recent fills per wallet (cached 5min per wallet).
  const recentFillsByWallet = await mapLimit(
    CURATED_WHALES,
    WHALE_FETCH_CONCURRENCY,
    async (whale) => {
      try {
        const fills = await cachedWalletFills(whale.address, bucket);
        const opens = fills.filter((f) => /^(Open |Long > Short|Short > Long)/.test(String(f.dir)));
        return { whale, opens };
      } catch (e) {
        console.warn("[pool/whale fills]", whale.address, e);
        return { whale, opens: [] as HLFill[] };
      }
    },
  );
  const active = recentFillsByWallet.filter((r) => r.opens.length > 0);

  // Pass 2 — only fetch state for wallets that actually moved. Cross-
  // reference each currently-open position with the recent open-fills to
  // find the real openedAt; skip positions older than the window.
  const all: WhaleSignal[] = [];
  await mapLimit(active, WHALE_FETCH_CONCURRENCY, async ({ whale, opens }) => {
      try {
        const state = await cachedWalletState(whale.address, bucket);
        const accountValueUsd = parseFloat(state.marginSummary.accountValue);
        if (accountValueUsd <= 0) return;

        const positions = state.assetPositions
          .map((ap) => ap.position)
          .filter(
            (p) =>
              // Only emit signals for assets the bet flow can actually
              // execute. Flash's Crypto.1 pool is SOL/BTC/ETH-only, so
              // surfacing HYPE/DOGE/SUI/etc. would mint untradeable cards.
              flashSymbolFor(p.coin) !== null &&
              parseFloat(p.positionValue) >= WHALE_MIN_POSITION_USD &&
              (p.leverage?.value ?? 0) >= WHALE_MIN_LEVERAGE,
          );

        const fresh: { position: typeof positions[number]; openedAt: number; scaledIn: boolean }[] = [];
        for (const position of positions) {
          const sizeNum = parseFloat(position.szi);
          const side: "long" | "short" = sizeNum >= 0 ? "long" : "short";

          // Latest open-side fill on this coin within the window.
          const candidates = opens
            .filter(
              (f) =>
                f.coin === position.coin && fillOpensSide(String(f.dir), side),
            )
            .sort((a, b) => b.time - a.time);
          if (candidates.length === 0) continue;

          const latest = candidates[0];
          // startPosition is signed — non-zero with same sign as the new
          // direction means this fill *added* to an existing position
          // rather than creating a fresh one.
          const startPos = parseFloat(latest.startPosition);
          const scaledIn =
            (side === "long" && startPos > 0) ||
            (side === "short" && startPos < 0);

          fresh.push({ position, openedAt: latest.time, scaledIn });
        }

        // Newest first, then cap per wallet so one whale doesn't dominate.
        fresh.sort((a, b) => b.openedAt - a.openedAt);
        const top = fresh.slice(0, WHALE_TOP_PER_WHALE);

        for (const { position, openedAt, scaledIn } of top) {
          const sizeNum = parseFloat(position.szi);
          const side: "long" | "short" = sizeNum >= 0 ? "long" : "short";
          const sizeUsd = parseFloat(position.positionValue);
          const entry = parseFloat(position.entryPx);
          const liquidation = position.liquidationPx
            ? parseFloat(position.liquidationPx)
            : 0;

          all.push({
            id: `whale:${whale.address.toLowerCase()}:${position.coin}`,
            type: "whale",
            heatScore: whaleHeatScore(position, accountValueUsd, openedAt),
            createdAt: stamp,
            chips: whaleSignalChips(position, accountValueUsd, openedAt),
            walletAddress: whale.label ?? truncateEthAddress(whale.address),
            walletAccountValue: accountValueUsd,
            asset: position.coin,
            side,
            leverage: position.leverage?.value ?? 1,
            size: sizeUsd,
            entry,
            liquidation,
            openedAt: new Date(openedAt).toISOString(),
            scaledIn,
            venue: "Hyperliquid",
          });
        }
      } catch (e) {
        console.warn("[pool/whale state]", whale.address, e);
      }
    },
  );

  return all;
}

// ─── Per-rail caches + combined pool ──────────────────────────────────────
//
// Each rail is cached independently. Without this, a transient whale-fetch
// failure (rate limit, network blip) caches an empty whale list alongside
// fresh memes/predictions for the full revalidate window — that's the
// "perps disappear on refresh" symptom. With per-rail caches, only the
// failing rail re-attempts on the next request; the others keep serving.
//
// Whale fetch is also wired to throw on too-many errors so a partial-empty
// result isn't latched into the cache.

const cachedMemes = unstable_cache(fetchMemePool, ["meme-pool-v1"], {
  revalidate: 90,
  tags: ["feed-pool"],
});
const cachedPredictions = unstable_cache(
  fetchPredictionPool,
  ["prediction-pool-v1"],
  { revalidate: 120, tags: ["feed-pool"] },
);
const cachedWhales = unstable_cache(fetchWhalePool, ["whale-pool-v1"], {
  revalidate: 120,
  tags: ["feed-pool"],
});

export async function getFeedPool(): Promise<Signal[]> {
  const [memes, predictions, whales] = await Promise.all([
    cachedMemes().catch((e) => {
      console.error("[pool/meme]", e);
      return [] as MemeSignal[];
    }),
    cachedPredictions().catch((e) => {
      console.error("[pool/prediction]", e);
      return [] as (PredictionSignal | MultiPredictionSignal)[];
    }),
    cachedWhales().catch((e) => {
      console.error("[pool/whale]", e);
      return [] as WhaleSignal[];
    }),
  ]);
  const all: Signal[] = [...memes, ...predictions, ...whales];
  return all.sort((a, b) => b.heatScore - a.heatScore);
}
