// lib/data/indicators.ts
//
// Pure technical indicators computed from candles/closes, used to give the LLM
// oracle bots *derived* signals (never raw OHLCV — raw numbers invite
// hallucinated arithmetic). All functions return null when there is not enough
// data so the brief can omit a line rather than emit a bogus number.

import type { Candle } from "./candles";

/** Exponential moving average over the last `period` values (returns the final EMA). */
export function ema(values: number[], period: number): number | null {
  if (period < 1 || values.length < period) return null;
  const k = 2 / (period + 1);
  // Seed with the SMA of the first `period` values, then roll forward.
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

/** Wilder's RSI over `period` (default 14). 0..100. */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface Macd {
  macd: number;
  signal: number;
  hist: number;
}

/** MACD (fast/slow/signal default 12/26/9) computed on closes. */
export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): Macd | null {
  if (closes.length < slow + signalPeriod) return null;
  // Build the MACD line series, then EMA-signal it.
  const macdSeries: number[] = [];
  for (let i = slow; i <= closes.length; i++) {
    const window = closes.slice(0, i);
    const f = ema(window, fast);
    const s = ema(window, slow);
    if (f == null || s == null) continue;
    macdSeries.push(f - s);
  }
  const macdLine = macdSeries[macdSeries.length - 1];
  const signal = ema(macdSeries, signalPeriod);
  if (macdLine == null || signal == null) return null;
  return { macd: macdLine, signal, hist: macdLine - signal };
}

/** Average True Range over `period` (default 14). */
export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  const recent = trs.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

/** Realized volatility = stdev of log returns (sample). Returns a fraction. */
export function realizedVol(closes: number[]): number | null {
  if (closes.length < 3) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] <= 0 || closes[i] <= 0) continue;
    rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance);
}
