// lib/arena/llm/demo-brief.ts
// Realistic static snapshot for the /arena/llm live view, so the bots reliably
// reason over indicators / OI / long-short / funding / sentiment without
// depending on flaky external market APIs. Swap for buildSharedBrief(real
// sources) when live data wiring lands.
import type { SharedBrief } from "./brief";

export const DEMO_BRIEF: SharedBrief = {
  timestampIso: "2026-06-13T16:00:00.000Z",
  markets: [
    { asset: "SOL", price: 152.4, change1hPct: 1.8, rsi14: 71, macdHist: 0.42, atr14: 3.1, volPct: 4.2, fundingRatePct: 0.012, openInterestUsd: 1_240_000_000, longPct: 63, shortPct: 37, takerBuySellRatio: 1.4, bias: "long" },
    { asset: "BTC", price: 112_300, change1hPct: 0.3, rsi14: 58, macdHist: 12.1, atr14: 480, volPct: 2.1, fundingRatePct: 0.008, openInterestUsd: 18_900_000_000, longPct: 54, shortPct: 46, takerBuySellRatio: 1.05, bias: "balanced" },
    { asset: "ETH", price: 3_980, change1hPct: -0.6, rsi14: 47, macdHist: -1.3, atr14: 36, volPct: 2.8, fundingRatePct: 0.004, openInterestUsd: 9_100_000_000, longPct: 49, shortPct: 51, takerBuySellRatio: 0.94, bias: "balanced" },
  ],
  sentiment: { score: 0.42, summary: "SOL breaking out on ETF-inflow chatter; majors steady, alt funding heating up", topics: ["SOL", "ETF", "funding"] },
};

export const FLAT_BOOK =
  "Your book: equity ~$1000 (free $1000), peak $1000, fees paid $0.00, funding paid $0.00, trades today 0\nOpen positions:\n  (flat — no open positions)";
