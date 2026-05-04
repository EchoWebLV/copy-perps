export type SignalLevel = "green" | "amber" | "purple";

export interface SignalChipData {
  text: string;
  level: SignalLevel;
}

export type SignalType = "meme" | "prediction" | "whale";

export interface BaseSignal {
  id: string;
  type: SignalType;
  heatScore: number;
  createdAt: string;
  chips: SignalChipData[];
}

export interface MemeSignal extends BaseSignal {
  type: "meme";
  ticker: string;
  name: string;
  chain: string;
  tokenAddress: string;
  tokenDecimals?: number;
  price: number;
  change1hPct: number;
  sparklinePath: string;
}

export interface PredictionSignal extends BaseSignal {
  type: "prediction";
  question: string;
  resolveDate: string;
  volume24h: number;
  yesProbability: number;
  eventId?: string;
  marketId?: string;
  series?: string;
}

export interface WhaleSignal extends BaseSignal {
  type: "whale";
  walletAddress: string;
  walletPnl30d: number;
  asset: string;
  side: "long" | "short";
  leverage: number;
  size: number;
  entry: number;
  liquidation: number;
  openedAtRelative: string;
  venue: string;
}

export type Signal = MemeSignal | PredictionSignal | WhaleSignal;

export type StakeAmount = 5 | 10 | 20 | 50;
