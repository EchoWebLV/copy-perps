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
// 1000d (~2.7y) keeps long-horizon political events (2028 nominations
// etc.) in the pool. Anything past that is too far out to feel like
// "live" content.
const PREDICTION_MAX_DAYS = 1000;

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

// Cap markets surfaced per event so a single multi-outcome event (e.g. a
// 44-candidate election) doesn't dominate the rail. Sorted by per-market
// volume so the most-watched outcomes come first.
const PREDICTION_MAX_PER_EVENT = 12;
// YES-price range a market must sit in to count as a bettable signal.
// 3–97% drops "effectively settled" markets (99/1, 98/2) without killing
// long-shot moonshots that still show meaningful action (5–10% probs).
// Tighten to .05–.95 if 95/5 markets still feel stale, or .10–.90 to
// keep only the genuinely-uncertain ones.
const PREDICTION_MIN_PROB = 0.03;
const PREDICTION_MAX_PROB = 0.97;

interface PredictionCandidate {
  event: JPEvent;
  market: JPMarket;
  isMultiOutcome: boolean;
  score: number;
}

async function fetchPredictionPool(): Promise<PredictionSignal[]> {
  // Jupiter's /events endpoint caps at 10 events regardless of `limit`.
  // The unlock for "more markets" is splitting multi-outcome events into
  // their nested per-candidate markets — those 10 events typically hold
  // 100–250 markets between them.
  const events = await listEvents({ limit: PREDICTION_FETCH_LIMIT });
  const now = Date.now();
  const candidates: PredictionCandidate[] = [];

  for (const ev of events) {
    if (!ev.isActive) continue;
    const open = openFutureMarkets(ev);
    if (open.length === 0) continue;

    // Event-level filters apply to all of its markets.
    const days = open
      .map((m) => (m.closeTime * 1000 - now) / (24 * 3600 * 1000))
      .reduce((min, v) => Math.min(min, v), Infinity);
    if (days > PREDICTION_MAX_DAYS) continue;

    const vol24 = Number(ev.volume24hr) / 1e6;
    if (vol24 < PREDICTION_MIN_VOL_USD) continue;

    const validMarkets = open
      .filter((m) => {
        const yes = parseFloat(m.outcomePrices?.[0] ?? "0");
        // Drop lopsided markets — 95/5 or worse isn't an interesting bet,
        // the favored side has no edge to take and the other side's
        // implied payout is huge but practically nil.
        return (
          Number.isFinite(yes) &&
          yes >= PREDICTION_MIN_PROB &&
          yes <= PREDICTION_MAX_PROB
        );
      })
      .sort((a, b) => (b.pricing?.volume ?? 0) - (a.pricing?.volume ?? 0))
      .slice(0, PREDICTION_MAX_PER_EVENT);

    const isMultiOutcome = open.length > 1;
    for (const market of validMarkets) {
      candidates.push({
        event: ev,
        market,
        isMultiOutcome,
        score: predictionHeatScore(ev, market),
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, PREDICTION_KEEP);

  const stamp = new Date().toISOString();
  return top.map(({ event, market, isMultiOutcome, score }) => {
    const yesProbability = parseFloat(market.outcomePrices[0]);
    // For multi-outcome events the market title alone is just the option
    // name (e.g. "Gavin Newsom") — combine with event title so the
    // question reads as a complete bet.
    const question = isMultiOutcome
      ? `${event.metadata.title} — ${market.title}`
      : event.metadata.title;
    const sig: PredictionSignal = {
      id: `prediction:${event.eventId}:${market.marketId}`,
      type: "prediction",
      heatScore: score,
      createdAt: stamp,
      chips: predictionSignalChips(event, market),
      question,
      resolveDate: fmtResolveDate(market.closeTime),
      volume24h: Number(event.volume24hr) / 1e6,
      yesProbability,
      eventId: event.eventId,
      marketId: market.marketId,
      series: event.metadata.series,
      imageUrl: market.imageUrl ?? event.metadata.imageUrl ?? null,
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
// Backwards-compat shim for whale rows written under the previous schema
// (walletPnl30d / openedAtRelative). The next refreshWhales run wipes
// these atomically, but until then we coalesce to the new field names so
// the card doesn't crash. Drop this once the live DB has only new-shape
// rows for a few cron cycles.
interface LegacyWhalePayload {
  walletPnl30d?: number;
  walletAccountValue?: number;
  openedAtRelative?: string;
  openedAt?: string;
  [k: string]: unknown;
}
function normalizeWhalePayload(raw: unknown): WhaleSignal {
  const p = raw as LegacyWhalePayload;
  return {
    ...(p as unknown as WhaleSignal),
    walletAccountValue: p.walletAccountValue ?? p.walletPnl30d ?? 0,
    openedAt: p.openedAt ?? new Date().toISOString(),
  };
}

async function fetchWhalePool(): Promise<WhaleSignal[]> {
  const rows = await db
    .select()
    .from(signalsTable)
    .where(eq(signalsTable.type, "whale"))
    .orderBy(desc(signalsTable.heatScore));
  return rows.map((r) => normalizeWhalePayload(r.payload));
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
