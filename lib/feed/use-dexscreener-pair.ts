"use client";

import { useEffect, useState } from "react";
import { memeSparkline } from "@/lib/signals/sparkline";

interface DSPair {
  pairAddress: string;
  liquidity?: { usd?: number };
  priceUsd: string;
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  volume?: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  marketCap?: number;
  fdv?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: Array<{ label?: string; url: string }>;
    socials?: Array<{ type?: string; url: string }>;
  };
}

export interface DexScreenerSocial {
  // Normalized social-link shape. type is one of "twitter" | "telegram"
  // | "discord" | "website" | other; url is the destination href.
  type: string;
  url: string;
}

export interface DexScreenerLive {
  marketCap: number | null;
  priceUsd: number | null;
  sparklinePath: string | null;
  change24hPct: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  // Buy txns / total txns over the last 24h, 0–1. Null when no txn data.
  buyRatio24h: number | null;
  pairCreatedAt: number | null;
  socials: DexScreenerSocial[];
}

const EMPTY: DexScreenerLive = {
  marketCap: null,
  priceUsd: null,
  sparklinePath: null,
  change24hPct: null,
  liquidityUsd: null,
  volume24hUsd: null,
  buyRatio24h: null,
  pairCreatedAt: null,
  socials: [],
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
        const buys = best?.txns?.h24?.buys ?? 0;
        const sells = best?.txns?.h24?.sells ?? 0;
        const totalTxns = buys + sells;
        const socials: DexScreenerSocial[] = [];
        if (best?.info) {
          for (const s of best.info.socials ?? []) {
            if (s.url) socials.push({ type: (s.type ?? "").toLowerCase(), url: s.url });
          }
          for (const w of best.info.websites ?? []) {
            if (w.url) socials.push({ type: "website", url: w.url });
          }
        }
        const next: DexScreenerLive = best
          ? {
              marketCap: best.marketCap ?? best.fdv ?? null,
              priceUsd: Number(best.priceUsd) || null,
              sparklinePath: best.priceChange
                ? memeSparkline(best.priceChange, mint)
                : null,
              change24hPct: best.priceChange?.h24 ?? null,
              liquidityUsd: best.liquidity?.usd ?? null,
              volume24hUsd: best.volume?.h24 ?? null,
              buyRatio24h: totalTxns > 0 ? buys / totalTxns : null,
              pairCreatedAt: best.pairCreatedAt ?? null,
              socials,
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
