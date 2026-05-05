export type SignalLevel = "green" | "amber" | "purple";

export interface SignalChipData {
  text: string;
  level: SignalLevel;
}

export type SignalType = "meme" | "prediction" | "whale" | "multiprediction";

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

export type Signal =
  | MemeSignal
  | PredictionSignal
  | WhaleSignal
  | MultiPredictionSignal;

export type StakeAmount = 5 | 10 | 20 | 50;
