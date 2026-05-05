import "server-only";
import { unstable_cache } from "next/cache";
import { desc, eq } from "drizzle-orm";
import type {
  Signal,
  MemeSignal,
  PredictionSignal,
  MultiPredictionSignal,
  MultiPredictionOutcome,
  WhaleSignal,
  SignalChipData,
} from "@/lib/types";
import { db } from "@/lib/db";
import { signals as signalsTable } from "@/lib/db/schema";
import { memeSparkline } from "@/lib/signals/sparkline";
import {
  listEvents,
  type JPEvent,
  type JPMarket,
} from "@/lib/jupiter-prediction/client";
import { predictionHeatScore, predictionSignalChips } from "@/lib/signals/heat-prediction";

// Pool sizes — these gate "infinity" before a reshuffle / repeat.
const MEME_FETCH_LIMIT = 100;
const PREDICTION_FETCH_LIMIT = 300;
const PREDICTION_KEEP = 150;
const MULTI_OUTCOMES_TO_SHOW = 4;

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
// The whale rail is cron-driven (not live-fetched). The signals table
// is populated by /api/cron/refresh-whales every 2 minutes — that path
// owns all Hyperliquid API calls, so page loads here just read the
// pre-computed rows. Locally, run `npm run refresh:whales` to populate
// the table once; the data stays fresh as long as you re-run periodically
// (or the deployed cron does it for you).
async function fetchWhalePool(): Promise<WhaleSignal[]> {
  const rows = await db
    .select()
    .from(signalsTable)
    .where(eq(signalsTable.type, "whale"))
    .orderBy(desc(signalsTable.heatScore));
  return rows.map((r) => r.payload as WhaleSignal);
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
