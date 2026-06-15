// ============================================================================
//  gwak ARENA — BOT TUNING  (edit the numbers, then run `npm run arena:tune`)
// ============================================================================
//
//  This is the ONE place to tune the live bots. Change any number below and run:
//
//      npm run arena:tune            # pushes to MAINNET (the live gwak.gg bots)
//      npm run arena:tune:devnet     # pushes to the devnet demo instead
//
//  It applies instantly on-chain (no redeploy, ~$0.001/bot) and prints a
//  before → after for every change. Safe: the on-chain program still clamps
//  everything to sane ranges, and only your admin key can push.
//
//  WHAT EACH KNOB DOES
//  -------------------
//  confidenceFloor    0–100. The bot must be at least this confident to OPEN.
//                     LOWER = trades more often (less picky). 40 ≈ lively, 65 ≈ picky.
//  cooldownSecs       Min seconds between decisions. LOWER = reacts faster / more trades.
//  maxLeverage        Leverage cap (1–…). Higher = bigger swings + bigger liquidation risk.
//  maxStakeBps        Bet size cap, in basis points of equity (10000 = 100%).
//                     If riskSizing=1 this is a RISK BUDGET (bps of equity risked per trade).
//  maxTradesPerDay    Daily open cap (anti-overtrading / fee-bleed guard).
//  dailyLossBps       Daily-loss kill switch in bps (1500 = stop trading after -15% that day).
//  riskSizing         0 = bot picks its own stake (up to maxStakeBps).
//                     1 = program computes stake from stop distance (disciplined).
//  minStopBps/maxStopBps  Allowed stop-loss band in bps (50 = 0.5%, 300 = 3%).
//  maxHoldTicks       Hard max-hold backstop (43200 ≈ 24h at the ~2s crank).
//
//  TIP: to make the arena livelier, lower confidenceFloor + cooldownSecs.
//       To calm a bot down, raise them.
// ============================================================================

export interface BotTuning {
  maxLeverage: number;
  maxStakeBps: number;
  confidenceFloor: number;
  cooldownSecs: number;
  maxTradesPerDay: number;
  dailyLossBps: number;
  riskSizing: 0 | 1;
  minStopBps: number;
  maxStopBps: number;
  fundingBpsPerHour: number;
  maxHoldTicks: number;
}

export const TUNING: Record<string, BotTuning> = {
  // Opus 4.8 (cautious Claude) — calmed to cut fee bleed: ~15% stake (was 35%),
  // pickier (conf 40), fewer trades. 15x keeps swings visible above the 10x floor.
  "claude-v1": {
    maxLeverage: 15, maxStakeBps: 1500, confidenceFloor: 40, cooldownSecs: 180,
    maxTradesPerDay: 10, dailyLossBps: 1500, riskSizing: 0,
    minStopBps: 50, maxStopBps: 300, fundingBpsPerHour: 2, maxHoldTicks: 43200,
  },
  // Grok 4.3 (bold) — calmed: 20% stake (was 50% — the worst fee offender),
  // pickier (conf 40), fewer trades, 18x (was 25x).
  "grok-v1": {
    maxLeverage: 18, maxStakeBps: 2000, confidenceFloor: 40, cooldownSecs: 180,
    maxTradesPerDay: 10, dailyLossBps: 1500, riskSizing: 0,
    minStopBps: 50, maxStopBps: 300, fundingBpsPerHour: 2, maxHoldTicks: 43200,
  },
  // GPT-5 (disciplined) — already risk-sized/low-fee; just a touch pickier + fewer trades.
  "gpt-v1": {
    maxLeverage: 12, maxStakeBps: 400, confidenceFloor: 50, cooldownSecs: 150,
    maxTradesPerDay: 8, dailyLossBps: 1000, riskSizing: 1,
    minStopBps: 50, maxStopBps: 300, fundingBpsPerHour: 2, maxHoldTicks: 43200,
  },
  // Aggressive Opus (degen Claude) — the wild one.
  "vader-v1": {
    maxLeverage: 40, maxStakeBps: 7500, confidenceFloor: 45, cooldownSecs: 120,
    maxTradesPerDay: 20, dailyLossBps: 3000, riskSizing: 0,
    minStopBps: 50, maxStopBps: 500, fundingBpsPerHour: 2, maxHoldTicks: 43200,
  },
};
