// lib/bots/resolver.ts
import { listBots, getStrategy } from "./index";
import { getMarksSnapshot } from "@/lib/data/marks";
import { getRecentLiquidations } from "@/lib/hyperliquid/client";
import { getFundingRates } from "@/lib/data/cex-funding";
import {
  openPaperPosition,
  closePaperPosition,
  fetchOpenPositions,
  computePaperPnlUsd,
} from "./paper";
import type { ExternalSignals, MarketContext } from "./types";

// Default notional used for paper-PnL computation. Real $ figure doesn't
// matter for paper bookkeeping — leaderboard ranks by percent return — but
// keeping a consistent number makes raw USD figures comparable across bots.
const PAPER_NOTIONAL_PER_BOT_USD = 1_000;

export async function tick(): Promise<{
  opened: number;
  closed: number;
}> {
  const [marks, liquidations, funding] = await Promise.all([
    getMarksSnapshot(),
    getRecentLiquidations(),
    getFundingRates(),
  ]);
  const signals: ExternalSignals = { liquidations, funding };
  const openPositions = await fetchOpenPositions();
  const openByBot = new Map(openPositions.map((p) => [p.botId, p]));

  let opened = 0;
  let closed = 0;

  for (const bot of listBots()) {
    if (bot.status !== "paper") continue;
    const strategy = getStrategy(bot.strategyKey);
    if (!strategy) continue;

    const existing = openByBot.get(bot.id);
    if (existing) {
      const mark = marks.get(existing.asset);
      if (mark == null) continue;
      const ctx: MarketContext = { asset: existing.asset, mark };
      if (strategy.evaluateExit(ctx, existing)) {
        const pnl = computePaperPnlUsd({
          side: existing.side,
          leverage: existing.leverage,
          entryMark: existing.entryMark,
          exitMark: mark,
          notionalUsd: PAPER_NOTIONAL_PER_BOT_USD,
        });
        await closePaperPosition({
          positionId: existing.id,
          exitMark: mark,
          paperPnlUsd: pnl,
          narration: null, // narrator runs out-of-band; Phase 2 wires it lazily
        });
        closed += 1;
      }
      continue;
    }

    // Bot is idle. Try each allowed market.
    for (const asset of strategy.markets) {
      const mark = marks.get(asset);
      if (mark == null) continue;
      const ctx: MarketContext = { asset, mark };
      const decision = strategy.evaluateEntry(ctx, signals);
      if (!decision) continue;
      await openPaperPosition({
        botId: bot.id,
        decision,
        entryMark: marks.get(decision.asset) ?? mark,
        narration: null,
      });
      opened += 1;
      break; // one position per bot per tick
    }
  }

  return { opened, closed };
}
