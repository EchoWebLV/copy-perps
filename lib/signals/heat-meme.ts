import type { DSPair } from "@/lib/dexscreener/client";
import type { SignalChipData } from "@/lib/types";

export function memeHeatScore(pair: DSPair): number {
  const volH1 = pair.volume?.h1 ?? 0;
  const volH24 = pair.volume?.h24 ?? 0;
  const avgHourly = volH24 / 24;
  const volRatio = avgHourly > 0 ? volH1 / avgHourly : 0;
  const volPoints = Math.min(50, volRatio * 12);

  const priceMove1h = Math.abs(pair.priceChange?.h1 ?? 0);
  const pricePoints = Math.min(30, priceMove1h * 1.5);

  let score = volPoints + pricePoints + 10; // +10 boosted-list bonus

  const liquidity = pair.liquidity?.usd ?? 0;
  if (liquidity < 50_000) score *= 0.7;
  if (liquidity < 20_000) score *= 0.5;

  return Math.round(Math.max(0, Math.min(100, score)));
}

export function memeSignalChips(pair: DSPair): SignalChipData[] {
  const chips: SignalChipData[] = [];

  const volH1 = pair.volume?.h1 ?? 0;
  const volH24 = pair.volume?.h24 ?? 0;
  const avgHourly = volH24 / 24;
  if (avgHourly > 0 && volH1 > avgHourly * 1.5) {
    const pct = Math.round((volH1 / avgHourly - 1) * 100);
    chips.push({ text: `Volume +${pct}% vs 24h avg`, level: "amber" });
  }

  const txnH1 = pair.txns?.h1;
  if (txnH1 && txnH1.buys > txnH1.sells && txnH1.buys + txnH1.sells > 20) {
    chips.push({
      text: `${txnH1.buys} buys vs ${txnH1.sells} sells (1h)`,
      level: "green",
    });
  }

  const liq = pair.liquidity?.usd ?? 0;
  if (liq > 200_000) {
    chips.push({
      text: `$${(liq / 1000).toFixed(0)}k liquidity`,
      level: "purple",
    });
  } else {
    chips.push({ text: "Trending boost on DexScreener", level: "purple" });
  }

  return chips.slice(0, 3);
}
