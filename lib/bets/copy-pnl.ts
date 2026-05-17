import { getPositionsHistory } from "@/lib/pacifica/client";

// Pacifica writes a fill into /positions/history a beat after the
// create_market (close) order returns, so we poll briefly before giving up.
const HISTORY_POLL_ATTEMPTS = 5;
const HISTORY_POLL_GAP_MS = 1500;

/**
 * Realized PnL (net of fees) of a single Pacifica order, summed across all
 * of that order's fills. One order can produce several maker/taker fills;
 * each history row carries that fill's `pnl` (gross realized PnL) and `fee`
 * (positive = paid, negative = rebate), so net = Σ pnl − Σ fee.
 *
 * Returns null if the order's fills never appear within the poll budget —
 * the caller should leave proceeds unset rather than record a fake value.
 */
export async function realizedPnlForOrder(params: {
  account: string;
  orderId: string;
}): Promise<number | null> {
  for (let attempt = 0; attempt < HISTORY_POLL_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, HISTORY_POLL_GAP_MS));
    }
    let rows;
    try {
      rows = await getPositionsHistory(params.account, 100);
    } catch {
      continue; // transient API error — retry
    }
    const mine = rows.filter(
      (r) => String(r.order_id) === String(params.orderId),
    );
    if (mine.length === 0) continue;
    let net = 0;
    for (const r of mine) {
      net += Number(r.pnl) - Number(r.fee);
    }
    return net;
  }
  return null;
}
