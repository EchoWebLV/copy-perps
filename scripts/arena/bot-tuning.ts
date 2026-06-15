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

// EVERY bot runs the IDENTICAL settings — the arena is a controlled experiment
// where the MODEL is the only variable (same prompt, same risk, same data).
// Edit SHARED once and it applies to all bots. Keep in sync with DEFAULT_FLOOR
// in lib/arena/llm/registry.ts.
const SHARED: BotTuning = {
  maxLeverage: 15, maxStakeBps: 1500, confidenceFloor: 40, cooldownSecs: 180,
  maxTradesPerDay: 10, dailyLossBps: 1500, riskSizing: 0,
  minStopBps: 50, maxStopBps: 300, fundingBpsPerHour: 2, maxHoldTicks: 43200,
};

export const TUNING: Record<string, BotTuning> = {
  "claude-v1": SHARED, // Opus 4.8
  "grok-v1": SHARED, // Grok 4.3
  "gpt-v1": SHARED, // GPT-5
  "vader-v1": SHARED, // Aggressive Opus (currently off in the worker roster)
};
