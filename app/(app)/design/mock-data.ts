// Shared mock data for the three design exploration pages.
// Pure static — no DB, no API. Each design page consumes the same shapes
// so visual comparison is apples-to-apples.

export interface MockPosition {
  id: string;
  asset: string;
  side: "long" | "short";
  leverage: number;
  entryMark: number;
  currentMark: number;
  stakeUsd: number;
  pnlPct: number;
  pnlUsd: number;
  openSinceMin: number;
  narration: string;
  evidence: Record<string, string | number>;
}

export interface MockBot {
  id: string;
  name: string;
  avatarEmoji: string;
  mood: "HUNTING" | "LOADED" | "WOUNDED" | "ON_STREAK" | "DORMANT";
  bankrollUsd: number;
  startingUsd: number;
  cashUsd: number;
  lifetimeReturnPct: number;
  leverage: number;
  positions: MockPosition[];
  stats: {
    totalTrades: number;
    winRate: number;
    paperPnl24hUsd: number;
    paperPnl7dUsd: number;
  };
}

export const MOCK_BOT: MockBot = {
  id: "liquidation-lizard",
  name: "Liquidation Lizard",
  avatarEmoji: "🦎",
  mood: "HUNTING",
  bankrollUsd: 1042,
  startingUsd: 1000,
  cashUsd: 815,
  lifetimeReturnPct: 0.042,
  leverage: 50,
  positions: [
    {
      id: "p1",
      asset: "HYPE",
      side: "short",
      leverage: 50,
      entryMark: 42.10,
      currentMark: 41.85,
      stakeUsd: 110,
      pnlPct: 0.297,
      pnlUsd: 32.67,
      openSinceMin: 8,
      narration: "longs about to get farmed. liquidation cascade incoming.",
      evidence: { liqUsd: 1_400_000, side: "long-liqs", venue: "Hyperliquid" },
    },
    {
      id: "p2",
      asset: "SOL",
      side: "short",
      leverage: 50,
      entryMark: 93.20,
      currentMark: 93.45,
      stakeUsd: 117,
      pnlPct: -0.134,
      pnlUsd: -15.67,
      openSinceMin: 23,
      narration: "fading the bounce. weak hands still long.",
      evidence: { liqUsd: 320_000, side: "long-liqs", venue: "Hyperliquid" },
    },
  ],
  stats: {
    totalTrades: 18,
    winRate: 0.67,
    paperPnl24hUsd: 42,
    paperPnl7dUsd: 138,
  },
};

export interface MockChatterEvent {
  id: string;
  botName: string;
  avatarEmoji: string;
  action: "opened" | "closed";
  side: "long" | "short";
  asset: string;
  leverage: number;
  pnlUsd?: number;
  quote: string;
  ago: string;
}

export const MOCK_CHATTER: MockChatterEvent[] = [
  {
    id: "c1",
    botName: "Liquidation Lizard",
    avatarEmoji: "🦎",
    action: "opened",
    side: "short",
    asset: "HYPE",
    leverage: 50,
    quote: "longs about to get farmed. liquidation cascade incoming.",
    ago: "2m",
  },
  {
    id: "c2",
    botName: "Funding Phoebe Lite",
    avatarEmoji: "📊",
    action: "closed",
    side: "long",
    asset: "SOL",
    leverage: 8,
    pnlUsd: 4.20,
    quote: "Funding flipped positive. Position closed at +4.2 bps capture.",
    ago: "5m",
  },
  {
    id: "c3",
    botName: "Momo Max Aggressive",
    avatarEmoji: "🚀",
    action: "opened",
    side: "long",
    asset: "BTC",
    leverage: 50,
    quote: "Breakout confirmed. Volume 2.3x baseline. Riding this.",
    ago: "9m",
  },
  {
    id: "c4",
    botName: "Mean-Revert Mike Patient",
    avatarEmoji: "🎯",
    action: "opened",
    side: "short",
    asset: "XRP",
    leverage: 5,
    quote: "Everyone's piling in again. Short's already fading.",
    ago: "14m",
  },
  {
    id: "c5",
    botName: "Vol Vector Hair-Trigger",
    avatarEmoji: "💥",
    action: "closed",
    side: "long",
    asset: "ETH",
    leverage: 40,
    pnlUsd: -12.50,
    quote: "Volatility collapsed faster than expected. Cut.",
    ago: "22m",
  },
];
