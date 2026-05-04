import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { signals } from "@/lib/db/schema";
import { getTopBoosted, getPairs, type DSPair } from "@/lib/dexscreener/client";
import { memeHeatScore, memeSignalChips } from "./heat-meme";
import { memeSparkline } from "./sparkline";
import type { MemeSignal } from "@/lib/types";

const MIN_LIQUIDITY = 10_000;
const MIN_PAIR_AGE_MS = 30 * 60 * 1000;
const FEED_LIMIT = 10;

export interface RefreshMemesResult {
  fetched: number;
  qualified: number;
  inserted: number;
  errors: number;
}

export async function refreshMemes(): Promise<RefreshMemesResult> {
  let errors = 0;

  const boosts = await getTopBoosted();
  const solBoosts = boosts.filter((b) => b.chainId === "solana");

  const candidates: { pair: DSPair; score: number }[] = [];

  await Promise.all(
    solBoosts.map(async (b) => {
      try {
        const pairs = await getPairs(b.tokenAddress);
        const best = pairs.reduce<DSPair | null>(
          (acc, p) =>
            !acc || (p.liquidity?.usd ?? 0) > (acc.liquidity?.usd ?? 0)
              ? p
              : acc,
          null,
        );
        if (!best) return;

        const liquidity = best.liquidity?.usd ?? 0;
        if (liquidity < MIN_LIQUIDITY) return;

        const ageMs = Date.now() - (best.pairCreatedAt ?? 0);
        if (ageMs < MIN_PAIR_AGE_MS) return;

        const score = memeHeatScore(best);
        candidates.push({ pair: best, score });
      } catch (e) {
        console.error("[refresh-memes] fetch error:", b.tokenAddress, e);
        errors++;
      }
    }),
  );

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, FEED_LIMIT);

  if (top.length === 0) {
    return { fetched: solBoosts.length, qualified: 0, inserted: 0, errors };
  }

  const now = new Date();
  const newRows = top.map(({ pair, score }) => {
    const id = `meme:${pair.baseToken.address}`;
    const ticker = `$${pair.baseToken.symbol.toUpperCase()}`;

    const payload: MemeSignal = {
      id,
      type: "meme",
      heatScore: score,
      createdAt: now.toISOString(),
      ticker,
      name: pair.baseToken.name,
      chain: "Solana",
      tokenAddress: pair.baseToken.address,
      price: Number(pair.priceUsd),
      marketCap: pair.marketCap ?? pair.fdv,
      change24hPct: pair.priceChange?.h24 ?? 0,
      sparklinePath: memeSparkline(pair.priceChange ?? {}),
      chips: memeSignalChips(pair),
    };

    return {
      id,
      type: "meme",
      assetId: ticker,
      heatScore: score,
      payload,
      createdAt: now,
    };
  });

  await db.delete(signals).where(eq(signals.type, "meme"));
  await db.insert(signals).values(newRows);

  return {
    fetched: solBoosts.length,
    qualified: top.length,
    inserted: newRows.length,
    errors,
  };
}
