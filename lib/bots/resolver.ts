// lib/bots/resolver.ts
import { listBots, getStrategy } from "./index";
import { getMarksSnapshot } from "@/lib/data/marks";
import {
  getRecentLiquidations,
  getRecentWhaleOpens,
} from "@/lib/hyperliquid/client";
import { getFundingRates } from "@/lib/data/cex-funding";
import {
  openPaperPosition,
  closePaperPosition,
  fetchOpenPositionsForBot,
  getBotBalance,
  isInLossCooldown,
  markBotBusted,
  computePaperPnlUsd,
} from "./paper";
import { getCrossBotSnapshot } from "./cross-bot";
import {
  narrateOpenSafe,
  narrateCloseSafe,
  narrateOpenFallback,
  narrateCloseFallback,
} from "./narrator";
import { familyOf } from "./wiring";
import {
  applyEntrySlippage,
  applyExitSlippage,
  slippageBpsFor,
  TAKER_FEE_BPS,
} from "./fees";
import type { ExternalSignals, MarketContext } from "./types";

const MAX_CONCURRENT_POSITIONS = 8;
const MAX_STAKE_PCT = 0.2;
const MIN_STAKE_USD = 10;
const BUST_THRESHOLD_USD = 10;
const MAX_BOTS_SAME_SIDE = 3;
// Tilt guard: two consecutive losses within 5 minutes parks new entries
// until either a green close lands or the window expires. Stops the
// strategy from doubling-down inside an actively-chopping regime that's
// eating its trigger.
const LOSS_STREAK_LENGTH = 2;
const LOSS_COOLDOWN_WINDOW_MS = 5 * 60 * 1000;
// Default cap on stake-PnL drawdown before the resolver forces an exit,
// regardless of what the strategy thinks. -0.5 = "this position lost 50% of
// the original stake, get out." Per-bot override via bot.config.stopLossPct.
const DEFAULT_STOP_LOSS_PCT = 0.5;

/** Per-bot override for the resolver's global MAX_STAKE_PCT. Lets a
 *  high-conviction scalper bot run at e.g. 80% of bankroll per trade
 *  while normal bots stick to 20%. Clamped to [0.05, 0.95] so a
 *  misconfigured bot can't try to stake 100% and trip a downstream
 *  zero-free-balance check. */
function readStakePctOverride(
  config: Record<string, unknown> | null | undefined,
): number | null {
  const raw = config?.stakePctOverride;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return null;
  }
  return Math.min(0.95, Math.max(0.05, raw));
}

function readStopLossPct(config: Record<string, unknown> | null | undefined): number {
  const raw = config?.stopLossPct;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_STOP_LOSS_PCT;
  }
  // Clamp to a sane range. 5% would chop every position; >100% means never.
  return Math.min(Math.max(raw, 0.05), 1.0);
}

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
  const [marks, liquidations, funding, crossBot, whaleOpens] = await Promise.all([
    getMarksSnapshot(),
    getRecentLiquidations(),
    getFundingRates(),
    getCrossBotSnapshot(),
    getRecentWhaleOpens(),
  ]);
  const signals: ExternalSignals = {
    liquidations,
    funding,
    whaleOpens,
    crossBot: { positionsByAssetSide: crossBot.positionsByAssetSide },
  };

  let opened = 0;
  let closed = 0;
  let busted = 0;

  for (const bot of listBots()) {
    if (bot.status !== "paper") continue;
    const strategy = getStrategy(bot.strategyKey);
    if (!strategy) continue;

    const stopLossPct = readStopLossPct(
      bot.config as Record<string, unknown> | null | undefined,
    );

    // Phase 1: evaluate exits on all open positions for this bot.
    const openPositions = await fetchOpenPositionsForBot(bot.id);
    for (const pos of openPositions) {
      const mark = marks.get(pos.asset);
      if (mark == null) continue;
      const ctx: MarketContext = { asset: pos.asset, mark };
      // Stop-loss runs BEFORE the strategy. A signal-driven strategy (funding,
      // mean-revert) might want to ride a deep drawdown waiting for its
      // setup to resolve — but the bankroll can't take an unlimited bleed.
      // PnL pct here is on STAKE, not on price: pnl_usd / stake_usd.
      // We close at the slipped fill — never the mid — so realized PnL
      // reflects what an actual market order would print.
      const exitFill = applyExitSlippage(mark, pos.side, pos.asset);
      const pnl = computePaperPnlUsd({
        side: pos.side,
        leverage: pos.leverage,
        entryMark: pos.entryMark,
        exitMark: exitFill,
        stakeUsd: pos.stakeUsd,
      });
      const stakePnlPct = pos.stakeUsd > 0 ? pnl / pos.stakeUsd : 0;
      const stoppedOut = stakePnlPct <= -stopLossPct;
      if (stoppedOut || strategy.evaluateExit(ctx, pos)) {
        const closeNarration =
          (await narrateCloseSafe({
            personaKey: bot.personaVoiceKey,
            asset: pos.asset,
            side: pos.side,
            entryMark: pos.entryMark,
            exitMark: mark,
            paperPnlUsd: pnl,
          })) ??
          narrateCloseFallback({
            asset: pos.asset,
            side: pos.side,
            paperPnlUsd: pnl,
          });
        await closePaperPosition({
          positionId: pos.id,
          botId: bot.id,
          exitMark: exitFill,
          paperPnlUsd: pnl,
          narration: closeNarration,
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

    // Tilt guard: pause new entries if the bot is on a fresh 2-loss
    // streak. Exits and stop-losses on existing positions still run
    // (already happened above in Phase 1).
    const onTilt = await isInLossCooldown({
      botId: bot.id,
      lossStreakLength: LOSS_STREAK_LENGTH,
      windowMs: LOSS_COOLDOWN_WINDOW_MS,
    });
    if (onTilt) continue;

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

      // Pileup prevention: skip if ≥MAX_BOTS_SAME_SIDE bots already hold this
      // (asset, side). Forces diversification across the roster.
      const sideKey = `${decision.asset}|${decision.side}`;
      const sameSideCount = crossBot.positionsByAssetSide.get(sideKey) ?? 0;
      if (sameSideCount >= MAX_BOTS_SAME_SIDE) continue;

      // Family dedupe: variants share strategy logic with their parent, so
      // letting Phoebe and Phoebe-Lite both short AVAX is one signal counted
      // twice. Allow only one open position per (family, asset, side).
      const myFamily = familyOf(bot.strategyKey);
      if (myFamily) {
        const familyKey = `${myFamily}|${decision.asset}|${decision.side}`;
        if (crossBot.familyHoldings.has(familyKey)) continue;
      }

      // Honor bot.config.stakePctOverride when set (e.g. 0.8 for the
      // scalpers); otherwise fall back to the global cap × conviction.
      const stakePctOverride = readStakePctOverride(
        bot.config as Record<string, unknown> | null | undefined,
      );
      const targetStake =
        stakePctOverride != null
          ? balance * stakePctOverride
          : balance * MAX_STAKE_PCT * decision.conviction;
      const stake = Math.min(targetStake, freeBalance);
      if (stake < MIN_STAKE_USD) continue;

      const midMark = marks.get(decision.asset) ?? mark;
      const entryMark = applyEntrySlippage(midMark, decision.side, decision.asset);
      const slipBps = slippageBpsFor(decision.asset);
      // Annotate the position's trigger meta with the cost stamps so the
      // evidence chip on the card can surface "you paid X bps slip + Y bps
      // fees" without us needing extra columns.
      const decisionWithCosts = {
        ...decision,
        triggerMeta: {
          ...decision.triggerMeta,
          entrySlipBps: slipBps,
          takerFeeBps: TAKER_FEE_BPS,
          midAtEntry: midMark,
        },
      };
      const openNarration =
        (await narrateOpenSafe({
          personaKey: bot.personaVoiceKey,
          asset: decision.asset,
          side: decision.side,
          leverage: decision.leverage,
          entryMark,
          trigger: decision.triggerMeta,
        })) ??
        narrateOpenFallback({
          asset: decision.asset,
          side: decision.side,
          leverage: decision.leverage,
          entryMark,
        });
      await openPaperPosition({
        botId: bot.id,
        decision: decisionWithCosts,
        entryMark,
        stakeUsd: stake,
        narration: openNarration,
      });
      opened += 1;
      slots -= 1;
      freeBalance -= stake;
      openAssets.add(decision.asset);
      // Increment local snapshot so the next iteration sees this bot's new
      // position when checking pileup (in case this bot also tries the same
      // asset+side via another market entry — unlikely but consistent).
      crossBot.positionsByAssetSide.set(
        sideKey,
        (crossBot.positionsByAssetSide.get(sideKey) ?? 0) + 1,
      );
      if (myFamily) {
        crossBot.familyHoldings.add(
          `${myFamily}|${decision.asset}|${decision.side}`,
        );
      }
    }
  }

  return { opened, closed, busted };
}
