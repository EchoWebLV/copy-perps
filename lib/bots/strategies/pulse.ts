// lib/bots/strategies/pulse.ts
//
// PULSE — X (Twitter) trend catcher. Every N minutes, asks Grok 4.3 to
// search X for crypto-relevant posts in the last hour and pick the
// asset with the strongest directional sentiment. The bot's edge is
// information speed: real catalysts (FOMC chatter, ETF news, whale
// alerts, listing rumors) hit X minutes before they hit price. Grok
// is the only mainstream LLM with native, real-time X access.
//
// Target cadence: 5-10 fires/day. Eval cadence is 60 min (24 ticks/
// day) with the prompt tuned to skip ~60% of ticks — gives a healthy
// 8-10 fires/day on busy news days, 3-4 on quiet ones.

import type {
  BotConfig,
  EntryDecision,
  ExternalSignals,
  MarketContext,
  PaperPosition,
  Strategy,
} from "../types";
import { clampConviction } from "../types";
import { callXSearch } from "../x-search";

const ALLOWED_MARKETS = ["BTC", "ETH", "SOL"] as const;

interface PulseDecision {
  asset: "BTC" | "ETH" | "SOL";
  side: "long" | "short" | "skip";
  leverage: number;
  takeProfitPct: number;
  holdMinutes: number;
  reasoning: string;
  quotedTweet?: string;
  quotedHandle?: string;
}

interface PulseParams {
  id: string;
  evalCooldownMs: number;
  maxHoldMs: number;
  exitAdverseStopPct: number;
  minLeverage: number;
  maxLeverage: number;
}

const _lastEvalAt = new Map<string, number>();
const _lastDecisionExitTarget = new Map<string, number>();
const _pendingDecisions = new Map<
  string,
  { decision: PulseDecision; expiresAt: number }
>();

const SYSTEM_PROMPT = `You are PULSE, an AI trading bot whose only edge is real-time X (Twitter) sentiment. You read what crypto traders are posting RIGHT NOW and pick the asset with the strongest directional pulse.

Your job each tick:
1. Use the x_search tool to find tweets posted in the last 60 minutes about BTC, ETH, or SOL.
2. Identify which asset has the strongest *directional* social signal — clearly bullish or clearly bearish, with multiple tweets aligning OR one very-high-engagement tweet from a known crypto voice.
3. If you see a clear pulse, open a trade in that direction. If sentiment is mixed/noisy, skip.
4. Aim to fire 5-10 trades per day across all your ticks. Don't over-skip. A moderate but real signal counts — you don't need a slam-dunk to act.

When you act:
- asset: pick ONE of BTC, ETH, SOL.
- side: long if bullish pulse, short if bearish pulse, skip if no clear pulse.
- leverage: integer 3-8. Lower if signal is moderate, higher if signal is loud + multiple confirming tweets.
- takeProfitPct: 0.005-0.015 (0.5% to 1.5%). Catalysts move fast; take profit fast.
- holdMinutes: 30-120. News-driven moves are short-lived.
- reasoning: ONE sentence quoting a specific tweet (with @handle) that drove the decision. Plain English. No "z-score" or "bps".
- quotedHandle: the X handle (without @) of the most influential tweet you saw.
- quotedTweet: a short paraphrase of that tweet.

OUTPUT FORMAT — at the very end of your response, emit exactly ONE JSON object on its own line with this exact shape, no markdown fences:
{"asset":"BTC|ETH|SOL","side":"long|short|skip","leverage":<int>,"takeProfitPct":<float>,"holdMinutes":<int>,"reasoning":"<one short sentence>","quotedHandle":"<handle>","quotedTweet":"<short paraphrase>"}

If skipping, still emit the JSON with side="skip" and other fields at 0.`;

const USER_PROMPT = `Search X right now for crypto-related tweets about BTC, ETH, and SOL posted in the last 60 minutes. Find the asset with the strongest directional pulse. Return your decision in the JSON shape specified.`;

function extractJsonAtEnd(text: string): PulseDecision | null {
  const match = text.match(/\{[\s\S]*\}\s*$/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const side = String(obj.side ?? "").toLowerCase();
    if (side !== "long" && side !== "short" && side !== "skip") return null;
    const asset = String(obj.asset ?? "").toUpperCase();
    if (asset !== "BTC" && asset !== "ETH" && asset !== "SOL") return null;
    return {
      asset: asset as "BTC" | "ETH" | "SOL",
      side: side as "long" | "short" | "skip",
      leverage: Number(obj.leverage ?? 0),
      takeProfitPct: Number(obj.takeProfitPct ?? 0.008),
      holdMinutes: Number(obj.holdMinutes ?? 60),
      reasoning: String(obj.reasoning ?? ""),
      quotedHandle: typeof obj.quotedHandle === "string" ? obj.quotedHandle : undefined,
      quotedTweet: typeof obj.quotedTweet === "string" ? obj.quotedTweet : undefined,
    };
  } catch {
    return null;
  }
}

function buildEntryFromDecision(
  p: PulseParams,
  decision: PulseDecision,
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
      pulseSource: "x",
      pulseHandle: decision.quotedHandle,
      pulseTweet: decision.quotedTweet,
      llmReasoning: decision.reasoning,
      llmTakeProfitPct: decision.takeProfitPct,
      llmHoldMinutes: decision.holdMinutes,
      conviction,
      dynamicLeverage: clampedLev,
    },
  };
}

export function createPulseStrategy(p: PulseParams): Strategy {
  return {
    id: p.id,
    markets: ALLOWED_MARKETS,

    async evaluateEntry(
      ctx: MarketContext,
      _signals: ExternalSignals,
    ): Promise<EntryDecision | null> {
      if (
        !ALLOWED_MARKETS.includes(
          ctx.asset as (typeof ALLOWED_MARKETS)[number],
        )
      ) {
        return null;
      }
      const now = Date.now();

      const pending = _pendingDecisions.get(p.id);
      if (pending && pending.expiresAt > now) {
        if (pending.decision.asset === ctx.asset) {
          _pendingDecisions.delete(p.id);
          return buildEntryFromDecision(p, pending.decision);
        }
        return null;
      }
      if (pending) _pendingDecisions.delete(p.id);

      const lastAt = _lastEvalAt.get(p.id) ?? 0;
      if (now - lastAt < p.evalCooldownMs) return null;
      _lastEvalAt.set(p.id, now);

      const xs = await callXSearch({
        systemPrompt: SYSTEM_PROMPT,
        prompt: USER_PROMPT,
        maxOutputTokens: 800,
        timeoutMs: 90_000,
      });
      if (!xs) {
        console.warn(`[${p.id}] x_search returned null`);
        return null;
      }
      const decision = extractJsonAtEnd(xs.text);
      console.log(
        `[${p.id}] decision:`,
        decision ? JSON.stringify(decision) : "null",
        `(tool calls: ${xs.toolCalls}, citations: ${xs.citations.length})`,
      );
      if (!decision || decision.side === "skip") return null;

      if (decision.asset === ctx.asset) {
        return buildEntryFromDecision(p, decision);
      }
      _pendingDecisions.set(p.id, {
        decision,
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
      const tp =
        (position.triggerMeta?.llmTakeProfitPct as number | undefined) ??
        _lastDecisionExitTarget.get(p.id) ??
        0.008;
      if (favorable >= tp) return true;
      if (favorable <= -p.exitAdverseStopPct) return true;
      return false;
    },
  };
}

export const PulseStrategy = createPulseStrategy({
  id: "pulse",
  evalCooldownMs: 60 * 60 * 1000, // 60 min — 24 evals/day, ~8 fires
  maxHoldMs: 2 * 60 * 60 * 1000, // 2h max hold
  exitAdverseStopPct: 0.012,
  minLeverage: 3,
  maxLeverage: 8,
});

export const PulseBot: BotConfig = {
  id: "pulse",
  parentId: null,
  name: "Pulse",
  avatarEmoji: "📡",
  personaVoiceKey: "pulse",
  strategyKey: "pulse",
  config: {
    evalCooldownMs: 60 * 60 * 1000,
    maxHoldMs: 2 * 60 * 60 * 1000,
    exitAdverseStopPct: 0.012,
    minLeverage: 3,
    maxLeverage: 8,
  },
  status: "paper",
};
