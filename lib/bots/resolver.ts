// lib/bots/resolver.ts
import { listBots, getStrategy } from "./index";
import { getMarksSnapshot } from "@/lib/data/marks";
import { getRecentLiquidations } from "@/lib/hyperliquid/client";
import { getFundingRates } from "@/lib/data/cex-funding";
import {
  openPaperPosition,
  closePaperPosition,
  fetchOpenPositionsForBot,
  getBotBalance,
  markBotBusted,
  computePaperPnlUsd,
} from "./paper";
import type { ExternalSignals, MarketContext } from "./types";

const MAX_CONCURRENT_POSITIONS = 4;
const MAX_STAKE_PCT = 0.5;
const MIN_STAKE_USD = 10;
const BUST_THRESHOLD_USD = 10;

/**
 * One resolver tick. For each paper bot:
 *  1. Evaluate exit on every currently-open position; close any whose
 *     strategy says exit. Closes credit the bot's balance via
 *     closePaperPosition.
 *  2. Recheck balance — if below the bust threshold, mark busted.
 *  3. Compute freeBalance = balance − sum(stake of remaining open positions).
 *  4. For each allowed market, ask evaluateEntry. If a decision comes back,
 *     size the new position at min(balance × MAX_STAKE_PCT × conviction,
 *     freeBalance), capped at MAX_CONCURRENT_POSITIONS per bot.
 */
export async function tick(): Promise<{
  opened: number;
  closed: number;
  busted: number;
}> {
  const [marks, liquidations, funding] = await Promise.all([
    getMarksSnapshot(),
    getRecentLiquidations(),
    getFundingRates(),
  ]);
  const signals: ExternalSignals = { liquidations, funding };

  let opened = 0;
  let closed = 0;
  let busted = 0;

  for (const bot of listBots()) {
    if (bot.status !== "paper") continue;
    const strategy = getStrategy(bot.strategyKey);
    if (!strategy) continue;

    // Phase 1: evaluate exits on all open positions for this bot.
    const openPositions = await fetchOpenPositionsForBot(bot.id);
    for (const pos of openPositions) {
      const mark = marks.get(pos.asset);
      if (mark == null) continue;
      const ctx: MarketContext = { asset: pos.asset, mark };
      if (strategy.evaluateExit(ctx, pos)) {
        const pnl = computePaperPnlUsd({
          side: pos.side,
          leverage: pos.leverage,
          entryMark: pos.entryMark,
          exitMark: mark,
          stakeUsd: pos.stakeUsd,
        });
        await closePaperPosition({
          positionId: pos.id,
          botId: bot.id,
          exitMark: mark,
          paperPnlUsd: pnl,
          narration: null,
        });
        closed += 1;
      }
    }

    // Phase 2: balance check after closes.
    const balance = await getBotBalance(bot.id);
    if (balance < BUST_THRESHOLD_USD) {
      await markBotBusted(bot.id);
      busted += 1;
      continue;
    }

    // Phase 3: figure out free balance and remaining slots.
    const remaining = await fetchOpenPositionsForBot(bot.id);
    const lockedStake = remaining.reduce((s, p) => s + p.stakeUsd, 0);
    let freeBalance = balance - lockedStake;
    let slots = MAX_CONCURRENT_POSITIONS - remaining.length;
    const openAssets = new Set(remaining.map((p) => p.asset));

    if (slots <= 0 || freeBalance < MIN_STAKE_USD) continue;

    // Phase 4: scan markets for entries.
    for (const asset of strategy.markets) {
      if (slots <= 0 || freeBalance < MIN_STAKE_USD) break;
      // Don't open a second position on the same asset for the same bot.
      if (openAssets.has(asset)) continue;
      const mark = marks.get(asset);
      if (mark == null) continue;
      const ctx: MarketContext = { asset, mark };
      const decision = await strategy.evaluateEntry(ctx, signals);
      if (!decision) continue;

      const targetStake = balance * MAX_STAKE_PCT * decision.conviction;
      const stake = Math.min(targetStake, freeBalance);
      if (stake < MIN_STAKE_USD) continue;

      await openPaperPosition({
        botId: bot.id,
        decision,
        entryMark: marks.get(decision.asset) ?? mark,
        stakeUsd: stake,
        narration: null,
      });
      opened += 1;
      slots -= 1;
      freeBalance -= stake;
      openAssets.add(decision.asset);
    }
  }

  return { opened, closed, busted };
}
