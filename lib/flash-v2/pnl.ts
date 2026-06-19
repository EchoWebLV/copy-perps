// lib/flash-v2/pnl.ts
import type { Side } from "./types";

/**
 * Mark-price PnL, client-side (GOTCHAS: ignore the indexer's tradeSpread PnL;
 * Flash's own UI uses mark price and only deducts execution + borrow fees).
 */
export function markPnlUsd(p: {
  side: Side;
  entryPrice: number;
  markPrice: number;
  sizeUsd: number;
  feesUsd?: number;
  borrowUsd?: number;
}): number {
  const dir = p.side === "long" ? 1 : -1;
  const pct = ((p.markPrice - p.entryPrice) / p.entryPrice) * dir;
  const gross = p.sizeUsd * pct;
  const net = gross - (p.feesUsd ?? 0) - (p.borrowUsd ?? 0);
  return Math.round(net * 1e6) / 1e6;
}
