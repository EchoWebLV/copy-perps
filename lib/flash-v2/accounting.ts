// lib/flash-v2/accounting.ts
/**
 * Available funds = ledger.deposits − basket.debits + basket.pendingCredits
 * (GOTCHAS: debits/pendingCredits are cumulative accounting lines, NOT a
 * balance — never display a single component). Clamp ≥ 0, round to 6 dp.
 */
export function availableUsdc(a: {
  ledgerDeposits: number;
  basketDebits: number;
  basketPendingCredits: number;
}): number {
  const v = a.ledgerDeposits - a.basketDebits + a.basketPendingCredits;
  return Math.max(0, Math.round(v * 1e6) / 1e6);
}
