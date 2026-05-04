interface PriceChange {
  m5?: number;
  h1?: number;
  h6?: number;
  h24?: number;
}

/**
 * Synthesize a 5-point sparkline path from DexScreener's percent-change buckets.
 * Maps to the existing card SVG viewBox of 0,0 to 300,90.
 */
export function memeSparkline(pc: PriceChange): string {
  const now = 1.0;
  const m5Ago = now / (1 + (pc.m5 ?? 0) / 100);
  const h1Ago = now / (1 + (pc.h1 ?? 0) / 100);
  const h6Ago = now / (1 + (pc.h6 ?? 0) / 100);
  const h24Ago = now / (1 + (pc.h24 ?? 0) / 100);

  const prices = [h24Ago, h6Ago, h1Ago, m5Ago, now];
  const xs = [0, 75, 150, 225, 300];

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const ys = prices.map((p) => 80 - ((p - min) / range) * 70);

  return ys
    .map((y, i) => `${i === 0 ? "M" : "L"}${xs[i]},${y.toFixed(0)}`)
    .join(" ");
}
