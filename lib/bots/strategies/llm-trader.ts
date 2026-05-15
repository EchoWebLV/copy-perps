// lib/bots/strategies/llm-trader.ts
//
// LLM-driven trading bot. Every N minutes the bot asks an LLM
// (Grok 4.3 or Claude Opus 4.7) what it would trade given the current
// market state — recent candles, funding, liquidations, the roster's
// other positions. The model returns a structured decision: side,
// leverage, hold time, take-profit %, plus a one-sentence reason.
//
// Edge source: information edge. The model has been trained on every
// chart pattern, macro setup, and reversal in financial history. It's
// not better than a pure technical trigger on noise — it's better on
// *context*. ("BTC at $112k, euphoric sentiment, positive funding —
// this is local-top territory" vs. just "candle closed > 0.3%, fire.")
//
// Cost guard: each tick we only ask the LLM if the cooldown window
// has elapsed AND there's no current open position. Defaults to 5 min
// between evaluations.
//
// Profitability is not promised. The point is to give Grok and Claude
// the same data the technical bots have and see if context-awareness
// alone produces an equity curve.

import { generateText } from "ai";
import { xai } from "@ai-sdk/xai";
import { anthropic } from "@ai-sdk/anthropic";
import { getCandles } from "@/lib/data/candles";
import type {
  BotConfig,
  EntryDecision,
  ExternalSignals,
  MarketContext,
  PaperPosition,
  Strategy,
} from "../types";
import { clampConviction } from "../types";

const ALLOWED_MARKETS = ["BTC", "ETH", "SOL"] as const;

export type LlmProvider = "xai" | "anthropic";

interface LlmTraderParams {
  id: string;
  provider: LlmProvider;
  modelId: string;
  evalCooldownMs: number;     // min ms between LLM calls (per bot, in-process)
  maxHoldMs: number;
  // Stop-out applied universally; the LLM picks the TP per-trade.
  exitAdverseStopPct: number;
  // Fallback leverage if the LLM's pick is out of bounds.
  defaultLeverage: number;
  minLeverage: number;
  maxLeverage: number;
}

interface LlmDecision {
  asset: string;
  side: "long" | "short" | "skip";
  leverage: number;
  takeProfitPct: number;
  holdMinutes: number;
  reasoning: string;
}

// Module-scoped per-strategy cooldown so a bot doesn't burn an LLM call
// every 60-second resolver tick.
const _lastEvalAt = new Map<string, number>();
const _lastDecisionExitTarget = new Map<string, number>();
// When the LLM picks an asset the resolver hasn't iterated to yet on the
// current tick, stash the decision keyed by bot id so the matching
// iteration can replay it. Expires fast so a stale pick from an earlier
// tick can't accidentally trade.
const _pendingDecisions = new Map<
  string,
  { decision: LlmDecision; expiresAt: number }
>();

function buildEntryFromDecision(
  p: LlmTraderParams,
  decision: LlmDecision,
): EntryDecision {
  const clampedLev = Math.max(
    p.minLeverage,
    Math.min(p.maxLeverage, Math.round(decision.leverage)),
  );
  const conviction = clampConviction(
    (clampedLev - p.minLeverage) / Math.max(1, p.maxLeverage - p.minLeverage),
  );
  _lastDecisionExitTarget.set(p.id, decision.takeProfitPct);
  return {
    asset: decision.asset,
    side: decision.side as "long" | "short",
    leverage: clampedLev,
    conviction,
    triggerMeta: {
      llmProvider: p.provider,
      llmModel: p.modelId,
      llmReasoning: decision.reasoning,
      llmTakeProfitPct: decision.takeProfitPct,
      llmHoldMinutes: decision.holdMinutes,
      conviction,
      dynamicLeverage: clampedLev,
    },
  };
}

async function callLlm(
  provider: LlmProvider,
  modelId: string,
  prompt: string,
): Promise<string> {
  if (provider === "xai") {
    const r = await generateText({
      model: xai(modelId),
      prompt,
      maxOutputTokens: 400,
      temperature: 0.4,
    });
    return r.text.trim();
  }
  const r = await generateText({
    model: anthropic(modelId),
    prompt,
    maxOutputTokens: 400,
    temperature: 0.4,
  });
  return r.text.trim();
}

// Parse the model's response. We expect a JSON object on the last line
// of the response. The reasoning before it is free text.
function parseDecision(raw: string): LlmDecision | null {
  // Look for the last JSON-looking line.
  const jsonMatch = raw.match(/\{[\s\S]*\}\s*$/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed && typeof parsed === "object") {
      const side = String(parsed.side ?? "").toLowerCase();
      if (side !== "long" && side !== "short" && side !== "skip") return null;
      return {
        asset: String(parsed.asset ?? "").toUpperCase(),
        side: side as "long" | "short" | "skip",
        leverage: Number(parsed.leverage ?? 0),
        takeProfitPct: Number(parsed.takeProfitPct ?? 0.01),
        holdMinutes: Number(parsed.holdMinutes ?? 60),
        reasoning: String(parsed.reasoning ?? ""),
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function buildMarketBrief(): Promise<string> {
  const lines: string[] = [];
  for (const asset of ALLOWED_MARKETS) {
    try {
      const candles1h = await getCandles(asset, "1h", 12);
      const candles15m = await getCandles(asset, "15m", 8);
      if (candles1h.length === 0 || candles15m.length === 0) continue;
      const last1h = candles1h[candles1h.length - 1];
      const first1h = candles1h[0];
      const change12h = ((last1h.close - first1h.open) / first1h.open) * 100;
      const last15m = candles15m[candles15m.length - 1];
      const change15m = ((last15m.close - last15m.open) / last15m.open) * 100;
      lines.push(
        `${asset}: now $${last1h.close.toFixed(2)}, 12h ${change12h >= 0 ? "+" : ""}${change12h.toFixed(2)}%, last 15m ${change15m >= 0 ? "+" : ""}${change15m.toFixed(2)}%`,
      );
    } catch {
      lines.push(`${asset}: data unavailable`);
    }
  }
  return lines.join("\n");
}

function buildSignalsBrief(signals: ExternalSignals): string {
  const lines: string[] = [];
  const fundingNotes: string[] = [];
  for (const asset of ALLOWED_MARKETS) {
    const f = signals.funding[asset];
    if (f && f.venuesAgreed >= 2) {
      const annualized = (f.avgRate * 1095 * 100).toFixed(1);
      fundingNotes.push(
        `${asset} funding ${(f.avgRate * 100).toFixed(3)}%/8h (annualized ${annualized}%)`,
      );
    }
  }
  if (fundingNotes.length > 0) lines.push(`Funding: ${fundingNotes.join("; ")}`);

  const recentCutoff = Date.now() - 60 * 1000;
  const recentLiqs = signals.liquidations.filter((l) => l.ts >= recentCutoff);
  if (recentLiqs.length > 0) {
    const byAsset = new Map<string, { long: number; short: number }>();
    for (const l of recentLiqs) {
      const entry = byAsset.get(l.asset) ?? { long: 0, short: 0 };
      if (l.side === "long") entry.long += l.notionalUsd;
      else entry.short += l.notionalUsd;
      byAsset.set(l.asset, entry);
    }
    const liqs: string[] = [];
    for (const [asset, v] of byAsset) {
      const total = v.long + v.short;
      if (total < 5_000_000) continue;
      const dominant = v.long > v.short ? "long" : "short";
      liqs.push(
        `${asset} liquidations last 60s: $${(total / 1e6).toFixed(1)}M (${dominant}s dominant)`,
      );
    }
    if (liqs.length > 0) lines.push(`Liquidations: ${liqs.join("; ")}`);
  }

  const whales = (signals.whaleOpens ?? []).filter((w) => w.notionalUsd >= 500_000);
  if (whales.length > 0) {
    const recent = whales.slice(-5);
    lines.push(
      `Recent whale opens: ${recent
        .map(
          (w) =>
            `${w.asset} ${w.side} $${(w.notionalUsd / 1e6).toFixed(2)}M @ ${w.px}`,
        )
        .join(", ")}`,
    );
  }

  const consensus: string[] = [];
  if (signals.crossBot) {
    for (const asset of ALLOWED_MARKETS) {
      const longs = signals.crossBot.positionsByAssetSide.get(`${asset}|long`) ?? 0;
      const shorts =
        signals.crossBot.positionsByAssetSide.get(`${asset}|short`) ?? 0;
      if (longs + shorts === 0) continue;
      consensus.push(`${asset} bots: ${longs}L / ${shorts}S`);
    }
  }
  if (consensus.length > 0) lines.push(`Roster positioning: ${consensus.join(", ")}`);

  return lines.length > 0 ? lines.join("\n") : "No notable external signals right now.";
}

const PROMPT_TEMPLATE = (
  botName: string,
  marketBrief: string,
  signalsBrief: string,
) => `You are ${botName}, an autonomous AI paper-trading bot competing in a live 11-bot perpetuals arena on Hyperliquid. You can trade BTC, ETH, or SOL with leverage. The other bots are technical traders, mirror bots, and event specialists — you are the LLM-driven one. Your edge is context-awareness: the technical bots fire on triggers; you reason about the situation.

Current market state:
${marketBrief}

External signals:
${signalsBrief}

Decide whether to OPEN a new position right now. You can pick ONE asset (BTC/ETH/SOL) or skip. Be selective — trading often is the death of edge.

Constraints:
- Leverage between 3 and 15. Higher conviction = higher leverage, but be honest.
- Take-profit between 0.4% and 2% (price move on the asset, not on stake).
- Hold time between 30 and 240 minutes.
- Skip if no clear setup exists. Most ticks should be skip.

Respond with a short paragraph of reasoning, then ON THE LAST LINE a single JSON object with this exact shape:
{"asset":"BTC|ETH|SOL","side":"long|short|skip","leverage":<int>,"takeProfitPct":<float, e.g. 0.008 for 0.8%>,"holdMinutes":<int>,"reasoning":"<one short sentence>"}

If skipping, still emit JSON with side="skip" and the other fields at 0.`;

export function createLlmTraderStrategy(p: LlmTraderParams): Strategy {
  return {
    id: p.id,
    markets: ALLOWED_MARKETS,

    async evaluateEntry(
      ctx: MarketContext,
      signals: ExternalSignals,
    ): Promise<EntryDecision | null> {
      if (
        !ALLOWED_MARKETS.includes(
          ctx.asset as (typeof ALLOWED_MARKETS)[number],
        )
      ) {
        return null;
      }
      const now = Date.now();

      // Replay: if a prior iteration in this tick called the LLM and
      // got a pick for THIS asset, consume the pending decision now.
      const pending = _pendingDecisions.get(p.id);
      if (pending && pending.expiresAt > now) {
        if (pending.decision.asset === ctx.asset) {
          _pendingDecisions.delete(p.id);
          return buildEntryFromDecision(p, pending.decision);
        }
        // Pending for a different asset — keep it alive for the matching
        // iteration later in this same resolver tick.
        return null;
      }
      if (pending) {
        _pendingDecisions.delete(p.id);
      }

      // Cooldown check: only invoke the LLM at most once per
      // p.evalCooldownMs window per bot.
      const lastAt = _lastEvalAt.get(p.id) ?? 0;
      if (now - lastAt < p.evalCooldownMs) return null;
      _lastEvalAt.set(p.id, now);

      const marketBrief = await buildMarketBrief();
      const signalsBrief = buildSignalsBrief(signals);
      const prompt = PROMPT_TEMPLATE(p.id, marketBrief, signalsBrief);

      let raw: string;
      try {
        raw = await callLlm(p.provider, p.modelId, prompt);
      } catch (err) {
        console.warn(`[${p.id}] LLM call failed:`, err);
        return null;
      }
      const decision = parseDecision(raw);
      if (!decision || decision.side === "skip") return null;
      if (
        !ALLOWED_MARKETS.includes(
          decision.asset as (typeof ALLOWED_MARKETS)[number],
        )
      ) {
        return null;
      }

      // If the LLM picked the asset we're on right now, return immediately.
      // Otherwise stash for the matching iteration later in this tick.
      if (decision.asset === ctx.asset) {
        return buildEntryFromDecision(p, decision);
      }
      _pendingDecisions.set(p.id, {
        decision,
        // 90s expiry covers the worst-case tick duration + small slack.
        expiresAt: now + 90_000,
      });
      return null;
    },

    evaluateExit(ctx: MarketContext, position: PaperPosition): boolean {
      const heldMs = Date.now() - position.entryTs.getTime();
      if (heldMs >= p.maxHoldMs) return true;
      const moveFrac =
        (ctx.mark - position.entryMark) / position.entryMark;
      const favorable = position.side === "long" ? moveFrac : -moveFrac;
      // Use the LLM's per-trade TP from the open decision when available.
      // Falls back to a sane default if we restarted the process.
      const takeProfit =
        (position.triggerMeta?.llmTakeProfitPct as number | undefined) ??
        _lastDecisionExitTarget.get(p.id) ??
        0.01;
      if (favorable >= takeProfit) return true;
      if (favorable <= -p.exitAdverseStopPct) return true;
      return false;
    },
  };
}

export const GrokTraderStrategy = createLlmTraderStrategy({
  id: "grok-trader",
  provider: "xai",
  modelId: "grok-4.3",
  evalCooldownMs: 5 * 60 * 1000,
  maxHoldMs: 4 * 60 * 60 * 1000,
  exitAdverseStopPct: 0.012,
  defaultLeverage: 8,
  minLeverage: 3,
  maxLeverage: 15,
});

export const ClaudeTraderStrategy = createLlmTraderStrategy({
  id: "claude-trader",
  provider: "anthropic",
  modelId: "claude-opus-4-7",
  evalCooldownMs: 5 * 60 * 1000,
  maxHoldMs: 4 * 60 * 60 * 1000,
  exitAdverseStopPct: 0.012,
  defaultLeverage: 8,
  minLeverage: 3,
  maxLeverage: 15,
});

export const GrokTraderBot: BotConfig = {
  id: "grok-trader",
  parentId: null,
  name: "Grok",
  avatarEmoji: "🤖",
  personaVoiceKey: "grok-trader",
  strategyKey: "grok-trader",
  config: {
    provider: "xai",
    modelId: "grok-4.3",
    evalCooldownMs: 5 * 60 * 1000,
    maxHoldMs: 4 * 60 * 60 * 1000,
    exitAdverseStopPct: 0.012,
    defaultLeverage: 8,
    minLeverage: 3,
    maxLeverage: 15,
  },
  status: "paper",
};

export const ClaudeTraderBot: BotConfig = {
  id: "claude-trader",
  parentId: null,
  name: "Claude",
  avatarEmoji: "🧠",
  personaVoiceKey: "claude-trader",
  strategyKey: "claude-trader",
  config: {
    provider: "anthropic",
    modelId: "claude-opus-4-7",
    evalCooldownMs: 5 * 60 * 1000,
    maxHoldMs: 4 * 60 * 60 * 1000,
    exitAdverseStopPct: 0.012,
    defaultLeverage: 8,
    minLeverage: 3,
    maxLeverage: 15,
  },
  status: "paper",
};
