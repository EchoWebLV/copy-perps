"use client";

import { useEffect, useState } from "react";
import { memeSparkline } from "@/lib/signals/sparkline";

interface DSPair {
  pairAddress: string;
  liquidity?: { usd?: number };
  priceUsd: string;
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  marketCap?: number;
  fdv?: number;
}

export interface DexScreenerLive {
  marketCap: number | null;
  priceUsd: number | null;
  sparklinePath: string | null;
  change24hPct: number | null;
}

const EMPTY: DexScreenerLive = {
  marketCap: null,
  priceUsd: null,
  sparklinePath: null,
  change24hPct: null,
};
const cache = new Map<string, DexScreenerLive>();

export function useDexScreenerPair(mint: string | undefined): DexScreenerLive {
  const initial = mint && cache.has(mint) ? cache.get(mint)! : EMPTY;
  const [data, setData] = useState<DexScreenerLive>(initial);

  useEffect(() => {
    if (!mint) return;
    if (cache.has(mint)) {
      setData(cache.get(mint)!);
      return;
    }
    let cancelled = false;
    fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((res: { pairs?: DSPair[] }) => {
        const pairs = res.pairs ?? [];
        const best = pairs.reduce<DSPair | null>(
          (acc, p) =>
            !acc || (p.liquidity?.usd ?? 0) > (acc.liquidity?.usd ?? 0)
              ? p
              : acc,
          null,
        );
        const next: DexScreenerLive = best
          ? {
              marketCap: best.marketCap ?? best.fdv ?? null,
              priceUsd: Number(best.priceUsd) || null,
              sparklinePath: best.priceChange
                ? memeSparkline(best.priceChange)
                : null,
              change24hPct: best.priceChange?.h24 ?? null,
            }
          : EMPTY;
        cache.set(mint, next);
        if (!cancelled) setData(next);
      })
      .catch(() => {
        cache.set(mint, EMPTY);
        if (!cancelled) setData(EMPTY);
      });
    return () => {
      cancelled = true;
    };
  }, [mint]);

  return data;
}
