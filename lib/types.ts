export type SignalLevel = "green" | "amber" | "purple";

export interface SignalChipData {
  text: string;
  level: SignalLevel;
}

export type SignalType =
  | "meme"
  | "prediction"
  | "whale"
  | "multiprediction"
  | "phoenix_trader";

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

export interface PhoenixTraderPosition {
  market: string;            // e.g. "SOL", "BTC", "ETH"
  side: "long" | "short";
  leverage: number;
  notionalUsd: number;
  entryPrice: number;
  unrealizedPnlPct: number;  // signed %, e.g. 12.4 or -8.1
  positionPubkey: string;    // Phoenix position account address
}

export interface PhoenixTraderStats7d {
  trades: number;
  winRatePct: number;
  pnlUsd: number;            // signed
  avgHoldMinutes: number;
}

export interface PhoenixTraderSignal extends BaseSignal {
  type: "phoenix_trader";
  authority: string;          // base58 Solana pubkey of the trader
  position: PhoenixTraderPosition | null;
  stats7d: PhoenixTraderStats7d;
  label?: string;             // optional display name from seed list
}

export type Signal =
  | MemeSignal
  | PredictionSignal
  | WhaleSignal
  | MultiPredictionSignal
  | PhoenixTraderSignal;

export type StakeAmount = 5 | 10 | 20 | 50;
