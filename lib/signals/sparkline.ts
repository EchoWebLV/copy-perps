interface PriceChange {
  m5?: number;
  h1?: number;
  h6?: number;
  h24?: number;
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Synthesize a dense sparkline path from DexScreener's percent-change buckets.
 * Returns an SVG `d` string for the line (no fill/closure) sized to viewBox 0,0 → 300,90.
 *
 * The 4 anchor points (24h, 6h, 1h, 5m) are eased between with smoothstep, then
 * dressed with seeded fractal noise so each token gets a stable, realistic-looking
 * chart rather than a 5-segment polyline.
 */
export function memeSparkline(pc: PriceChange, seed = "default"): string {
  const now = 1.0;
  const m5Ago = now / (1 + (pc.m5 ?? 0) / 100);
  const h1Ago = now / (1 + (pc.h1 ?? 0) / 100);
  const h6Ago = now / (1 + (pc.h6 ?? 0) / 100);
  const h24Ago = now / (1 + (pc.h24 ?? 0) / 100);

  const anchors: { t: number; p: number }[] = [
    { t: 0, p: h24Ago },
    { t: 0.75, p: h6Ago },
    { t: 0.958, p: h1Ago },
    { t: 0.997, p: m5Ago },
    { t: 1, p: now },
  ];

  const N = 96;
  const rng = mulberry32(hashSeed(seed));
  const volatility =
    Math.max(...anchors.map((a) => Math.abs(a.p - 1))) || 0.02;
  const noiseScale = volatility * 0.55;

  const prices: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    let j = 0;
    while (j < anchors.length - 2 && t > anchors[j + 1].t) j++;
    const a = anchors[j];
    const b = anchors[j + 1];
    const segT = (t - a.t) / (b.t - a.t || 1);
    const k = segT * segT * (3 - 2 * segT);
    const base = a.p + (b.p - a.p) * k;
    const n =
      (rng() - 0.5) * noiseScale +
      (rng() - 0.5) * noiseScale * 0.5 +
      (rng() - 0.5) * noiseScale * 0.25;
    prices.push(base + n);
  }
  prices[N - 1] = now;

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const xs = prices.map((_, i) => (i / (N - 1)) * 300);
  const ys = prices.map((p) => 80 - ((p - min) / range) * 70);

  return ys
    .map((y, i) => `${i === 0 ? "M" : "L"}${xs[i].toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
}
