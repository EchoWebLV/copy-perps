export type SignalLevel = "green" | "amber" | "purple";

export interface SignalChipData {
  text: string;
  level: SignalLevel;
}

export type SignalType =
  | "meme"
  | "prediction"
  | "whale"
  | "whale_trader"
  | "whale_position"
  | "multiprediction"
  | "pacifica_trader"
  | "bot";

export interface BaseSignal {
  id: string;
  type: SignalType;
  heatScore: number;
  createdAt: string;
  chips: SignalChipData[];
}

export interface MultiPredictionOutcome {
  label: string;
  marketId: string;
  yesProbability: number;
}

export interface MemeSignal extends BaseSignal {
  type: "meme";
  ticker: string;
  name: string;
  chain: string;
  tokenAddress: string;
  tokenDecimals?: number;
  price: number;
  marketCap?: number;
  change24hPct: number;
  sparklinePath: string;
}

export interface PredictionSignal extends BaseSignal {
  type: "prediction";
  question: string;
  resolveDate: string;
  // Unix seconds. Optional for backwards compat with signals already in
  // the cache that predate this field — gets populated on next cron
  // refresh. Used by the card's countdown timer.
  resolveAt?: number;
  volume24h: number;
  yesProbability: number;
  eventId?: string;
  marketId?: string;
  series?: string;
  imageUrl?: string | null;
}

export interface WhaleSignal extends BaseSignal {
  type: "whale";
  walletAddress: string;
  walletAccountValue: number;
  asset: string;
  side: "long" | "short";
  leverage: number;
  size: number;
  entry: number;
  liquidation: number;
  openedAt: string;
  scaledIn?: boolean;
  venue: string;
}

export interface MultiPredictionSignal extends BaseSignal {
  type: "multiprediction";
  question: string;
  resolveDate: string;
  resolveAt?: number;
  volume24h: number;
  eventId: string;
  series?: string;
  outcomes: MultiPredictionOutcome[];
  totalOutcomes: number;
  imageUrl?: string | null;
}

export interface PacificaTraderPosition {
  market: string;            // "SOL", "BTC", "ETH", ...
  side: "long" | "short";
  // Leverage is implied by (notional/margin) for isolated positions;
  // for cross we approximate to the market's max_leverage cap.
  leverage: number;
  notionalUsd: number;
  entryPrice: number;
  liquidationPrice: number;
  // Pacifica's /positions endpoint does not surface unrealized PnL.
  // Null in Phase 1 (compute via WS mark price in Phase 2 if needed).
  // Identify positions by (account, market, side) — no per-position id.
  unrealizedPnlPct: number | null;
  // ms epoch when the leader opened this position. Used for "opened
  // 4m ago" labels and the "fresh" pulse on positions <15min old.
  openedAtMs: number;
}

export interface PacificaTraderStats {
  equityUsdc: number;
  openInterestUsdc: number;
  pnl1dUsdc: number;
  pnl7dUsdc: number;
  pnl30dUsdc: number;
  pnlAllTimeUsdc: number;
  volume1dUsdc: number;
  volume7dUsdc: number;
  // From recent trades-history. Streak = consecutive winning trades
  // ending at the latest close (0 if their last close was a loser).
  // 1d win rate is wins / total closes in the last 24h, or null when
  // the trader hasn't closed anything in the window.
  winStreak: number;
  winRatePct1d: number | null;
  totalCloses1d: number;
}

export interface PacificaTraderSignal extends BaseSignal {
  type: "pacifica_trader";
  address: string;          // base58 Solana pubkey (user's main wallet on Pacifica)
  username: string | null;  // Pacifica display name, if set
  // Up to 3 open positions ordered by notional desc. Cards render
  // each as its own tap-to-copy row. Empty array = "watching".
  positions: PacificaTraderPosition[];
  stats: PacificaTraderStats;
}

export interface WhaleTraderSignal extends BaseSignal {
  type: "whale_trader";
  payload: {
    whaleId: string;
    source: "pacifica" | "hyperliquid";
    sourceAccount: string;
    displayName: string;
    avatarUrl: string | null;
    tags: string[];
    openPositionsCount: number;
    bestPosition: WhalePositionSignal["payload"] | null;
    stats: {
      pnl1dUsdc: number;
      pnl7dUsdc: number;
      pnl30dUsdc: number;
      winRatePct1d: number | null;
      totalCloses1d: number;
      volume1dUsdc: number;
    };
    lastSeenAt: string | null;
    stale: boolean;
  };
}

export interface WhalePositionSignal extends BaseSignal {
  type: "whale_position";
  payload: {
    positionId: string;
    whaleId: string;
    source: "pacifica" | "hyperliquid";
    sourceAccount: string;
    displayName: string;
    avatarUrl: string | null;
    market: string;
    side: "long" | "short";
    leverage: number;
    amountBase: number;
    notionalUsd: number;
    entryPrice: number;
    currentMark: number | null;
    unrealizedPnlPct: number | null;
    openedAtMs: number;
    lastSeenAtMs: number;
    stale: boolean;
    analysis: {
      summary: string;
      thesis: string;
      risk: string;
      entryGapWarning: string | null;
      confidence: number;
    } | null;
  };
}

export interface BotSignal extends BaseSignal {
  type: "bot";
  payload: {
    botId: string;
    botName: string;
    avatarEmoji: string;
    // Generated robot portrait URL when available; null falls back to the
    // emoji. See lib/bots/avatars.ts.
    avatarImageUrl: string | null;
    // Equity: cash + unrealized PnL across open positions. This is the
    // headline "what this bot is worth" number — what the BANKROLL chip
    // shows. Cash-only is exposed separately as cashUsd.
    balanceUsd: number;
    cashUsd: number;
    startingBalanceUsd: number;
    lifetimeReturnPct: number; // (equity − starting) / starting
    freeBalanceUsd: number;
    // Deterministic visual state — computed each signal build, no LLM.
    // null when admin has disabled mood badges via thought_settings.
    mood: import("./bots/mood").MoodBadge | null;
    busted: boolean;
    currentPositions: Array<{
      positionId: string;
      asset: string;
      side: "long" | "short";
      leverage: number;
      entryMark: number;
      currentMark: number;
      stakeUsd: number;
      livePaperPnlPct: number;
      livePaperPnlUsd: number;
      openSinceMs: number;
      narrationOpen: string | null;
      triggerMeta: Record<string, unknown> | null;
      disagreements: Array<{
        botId: string;
        botName: string;
        avatarEmoji: string;
        avatarImageUrl: string | null;
      }>;
    }>;
    stats: {
      totalTrades: number;
      // null when totalTrades is below the noise floor (N<5).
      // UI renders "—" or a sample-size hint instead of a misleading "0%".
      winRate: number | null;
      paperPnl24hUsd: number;
      paperPnl7dUsd: number;
      paperPnlAllUsd: number;
    };
  };
}

export type Signal =
  | MemeSignal
  | PredictionSignal
  | WhaleSignal
  | WhaleTraderSignal
  | WhalePositionSignal
  | MultiPredictionSignal
  | PacificaTraderSignal
  | BotSignal;

export type StakeAmount = 5 | 10 | 20 | 50;
