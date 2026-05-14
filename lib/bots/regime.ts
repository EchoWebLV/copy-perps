// lib/bots/regime.ts
//
// xAI-driven per-asset regime classifier. Strategies that are regime-sensitive
// (Mean-Revert Mike, Momo Max, Vol Vector, Boomer Trend) gate their entries
// against this label so they don't fight the market. Cached 60s per asset.
//
// Failure mode is intentionally fail-OPEN: when xAI errors or returns
// garbage, getRegime returns null and the strategy fires normally. Better
// to trade with degraded info than to freeze the whole roster on a single
// API outage.

import { generateText } from "ai";
import { xai } from "@ai-sdk/xai";
import { getCandles } from "@/lib/data/candles";

export type Regime =
  | "trending-up"
  | "trending-down"
  | "mean-reverting"
  | "vol-expanding"
  | "chop";

export interface RegimeSnapshot {
  regime: Regime;
  confidence: number; // 0..1
  sampledAtMs: number;
}

const VALID_REGIMES = new Set<Regime>([
  "trending-up",
  "trending-down",
  "mean-reverting",
  "vol-expanding",
  "chop",
]);

const MODEL_ID = "grok-4.20-non-reasoning";
const TTL_MS = 60_000;
const _cache = new Map<string, { snapshot: RegimeSnapshot; expiresAt: number }>();

interface Features {
  meanReturn: number;
  stddev: number;
  zScore: number;
  emaRatio: number;
}

function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let result = values[0];
  for (let i = 1; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
  }
  return result;
}

function computeFeatures(candles: { close: number }[]): Features | null {
  if (candles.length < 21) return null;
  const closes = candles.map((c) => c.close);
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev === 0) continue;
    returns.push((closes[i] - prev) / prev);
  }
  if (returns.length < 2) return null;
  const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - meanReturn) * (r - meanReturn), 0) /
    returns.length;
  const stddev = Math.sqrt(variance);
  const last = closes[closes.length - 1];
  const mean = closes.reduce((s, v) => s + v, 0) / closes.length;
  const closeStddev = Math.sqrt(
    closes.reduce((s, v) => s + (v - mean) * (v - mean), 0) / closes.length,
  );
  const zScore = closeStddev === 0 ? 0 : (last - mean) / closeStddev;
  const emaFast = ema(closes, 7);
  const emaSlow = ema(closes, 21);
  const emaRatio = emaSlow === 0 ? 1 : emaFast / emaSlow;
  return { meanReturn, stddev, zScore, emaRatio };
}

const SYSTEM_PROMPT = `You are a deterministic market-regime classifier. Given numeric features computed from recent 1-minute candles, output exactly one JSON object: {"regime": "<label>", "confidence": <number between 0 and 1>}.

Allowed labels:
- trending-up: sustained upward drift; momentum likely to continue
- trending-down: sustained downward drift
- mean-reverting: prices oscillating around a stable mean
- vol-expanding: realized volatility recently increased; large moves likely
- chop: low volatility; range-bound

Output ONLY valid JSON, no commentary or prose.`;

function buildUserPrompt(asset: string, f: Features): string {
  return [
    `Asset: ${asset}`,
    `30m mean return: ${f.meanReturn.toExponential(4)}`,
    `30m return stddev: ${f.stddev.toExponential(4)}`,
    `Current z-score vs 30m mean: ${f.zScore.toFixed(3)}`,
    `EMA7/EMA21 ratio: ${f.emaRatio.toFixed(4)}`,
  ].join("\n");
}

/**
 * Returns the regime snapshot for an asset, or null if data is insufficient
 * or xAI errored. Caching is per-asset, 60s TTL.
 */
export async function getRegime(asset: string): Promise<RegimeSnapshot | null> {
  const cached = _cache.get(asset);
  if (cached && cached.expiresAt > Date.now()) return cached.snapshot;

  const candles = await getCandles(asset, "1m", 30);
  const features = computeFeatures(candles);
  if (!features) return null;

  let text: string;
  try {
    const result = await generateText({
      model: xai(MODEL_ID),
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(asset, features),
      maxOutputTokens: 60,
    });
    text = result.text.trim();
  } catch (err) {
    console.error("[regime] xAI error:", err);
    return null;
  }

  // Parse the JSON. Strip code-fence markers if Grok added them.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error("[regime] xAI returned non-JSON:", text.slice(0, 120));
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as { regime?: unknown; confidence?: unknown };
  const regime = obj.regime as Regime;
  if (typeof regime !== "string" || !VALID_REGIMES.has(regime)) return null;
  const rawConfidence = typeof obj.confidence === "number" ? obj.confidence : 0.5;
  const confidence = Math.min(1, Math.max(0, rawConfidence));

  const snapshot: RegimeSnapshot = {
    regime,
    confidence,
    sampledAtMs: Date.now(),
  };
  _cache.set(asset, { snapshot, expiresAt: Date.now() + TTL_MS });
  return snapshot;
}

// Test-only escape hatch — keep the production module clean; tests reach
// in via the module's exported map via Vitest's vi.resetModules if needed.
// For Phase 3 we rely on TTL elapsing naturally; tests using fake timers
// can advance time, or use the per-call mock pattern.
