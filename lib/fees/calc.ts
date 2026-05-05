// Per-bet fee model:
//   profit  = stake * 0.005   (the 0.5% margin)
//   sol_pt  = $0.05 flat      (covers SOL gas; subsidizes cold-start)
//   total   = profit + sol_pt
//
// Charged in USDC inside the same tx as the bet. Spec:
// docs/superpowers/specs/2026-05-05-gasless-trades-design.md
const PROFIT_BPS = 50;
const SOL_PASSTHROUGH_USD = 0.05;

export interface BetFee {
  profitUsdc: number;
  solPassthroughUsdc: number;
  totalFeeUsdc: number;
}

export function computeBetFee(stakeUsdc: number): BetFee {
  const profitUsdc = (stakeUsdc * PROFIT_BPS) / 10_000;
  return {
    profitUsdc,
    solPassthroughUsdc: SOL_PASSTHROUGH_USD,
    totalFeeUsdc: profitUsdc + SOL_PASSTHROUGH_USD,
  };
}
