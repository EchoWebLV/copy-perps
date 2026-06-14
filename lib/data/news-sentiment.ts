// lib/data/news-sentiment.ts
//
// Free, key-less market-sentiment source for the arena brief. Blends the
// Crypto Fear & Greed Index (alternative.me — market-wide, updates ~daily)
// with CoinGecko per-coin community up/down votes (per-asset flavour). Returns
// the SentimentBrief the LLM brief renders. Cached so ONE fetch is shared
// across all bots per tick (no per-bot fan-out; gentle on the free endpoints).
//
// Honest scope: this is market/community sentiment, not breaking news. The
// brief renders it under "Market sentiment". No API key, no extra LLM cost.

import type { SentimentBrief } from "../arena/llm/brief";

const CACHE_MS = 5 * 60_000; // ~one tick; shared across bots

const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
};

export interface FearGreed {
  value: number; // 0..100
  label: string; // e.g. "Extreme Fear"
  score: number; // -1..1
}

let cache: { at: number; value: SentimentBrief | null } | null = null;

const clamp1 = (n: number): number => Math.max(-1, Math.min(1, n));

/** Fear & Greed Index (0..100) → score -1..1 + classification. Null on failure. */
export async function fetchFearGreed(): Promise<FearGreed | null> {
  try {
    const r = await fetch("https://api.alternative.me/fng/?limit=1", {
      cache: "no-store",
    });
    if (!r.ok) return null;
    const data = (await r.json()) as {
      data?: { value?: string; value_classification?: string }[];
    };
    const row = data.data?.[0];
    const value = Number(row?.value);
    if (!Number.isFinite(value)) return null;
    return {
      value,
      label: row?.value_classification ?? "—",
      score: clamp1((value - 50) / 50),
    };
  } catch {
    return null;
  }
}

/** CoinGecko per-coin community up-vote % → { asset: upPct }. Best-effort. */
export async function fetchCommunityVotes(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(
    Object.entries(COINGECKO_IDS).map(async ([asset, id]) => {
      try {
        const r = await fetch(
          `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`,
          { cache: "no-store" },
        );
        if (!r.ok) return;
        const o = (await r.json()) as { sentiment_votes_up_percentage?: number };
        if (typeof o.sentiment_votes_up_percentage === "number") {
          out[asset] = o.sentiment_votes_up_percentage;
        }
      } catch {
        // best-effort: skip this asset
      }
    }),
  );
  return out;
}

/** Pure mapper: fold Fear & Greed + community votes into a SentimentBrief.
 *  Score is the mean of whichever signals are present; null when neither is. */
export function buildSentimentBrief(
  fg: FearGreed | null,
  votes: Record<string, number>,
): SentimentBrief | null {
  const parts: string[] = [];
  const topics: string[] = [];
  let score = 0;
  let n = 0;

  if (fg) {
    parts.push(`Fear & Greed ${fg.value}/100 (${fg.label})`);
    topics.push("fear-greed");
    score += fg.score;
    n += 1;
  }

  const voteEntries = Object.entries(votes);
  if (voteEntries.length > 0) {
    const avgUp =
      voteEntries.reduce((sum, [, up]) => sum + up, 0) / voteEntries.length;
    score += clamp1((avgUp - 50) / 50);
    n += 1;
    parts.push(
      "community votes " +
        voteEntries.map(([a, up]) => `${a} ${Math.round(up)}% up`).join(", "),
    );
    topics.push("community-votes");
  }

  if (n === 0) return null;
  return {
    score: clamp1(score / n),
    summary: parts.join("; "),
    topics,
  };
}

/** The brief's `newsSentiment` source. Cached ~5 min so the per-tick fetch is
 *  shared across every bot. Returns null (brief omits the line) on total
 *  failure — never throws into the decision loop. */
export async function getNewsSentiment(): Promise<SentimentBrief | null> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.value;
  const [fg, votes] = await Promise.all([
    fetchFearGreed(),
    fetchCommunityVotes(),
  ]);
  const value = buildSentimentBrief(fg, votes);
  cache = { at: now, value };
  return value;
}
