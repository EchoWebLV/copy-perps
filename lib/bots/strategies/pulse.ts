// lib/bots/strategies/pulse.ts
//
// PULSE — X (Twitter) catalyst trader. Every 60 min, asks Grok 4.3 to
// search X for genuine, concrete, corroborated market catalysts (ETF
// flows, regulatory headlines, listings, macro prints, big on-chain
// moves) on BTC/ETH/SOL — and to SKIP everything else: vibes, hype,
// mood, lone shitposts. Most ticks skip.
//
// A catalyst that passes the analytical bar still has to clear a price-
// confirmation gate before the trade opens: if price has already moved
// meaningfully against the catalyst's direction, the trade is dropped
// (no longing into a visible dump on the strength of a post).
//
// Exits are asymmetric: cut losers fast (~0.7% adverse), let winners
// run (LLM-set 1.5-3.5% take-profit). Leverage 10-30x by conviction.

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
import { getCandles } from "@/lib/data/candles";

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

const SYSTEM_PROMPT = `You are PULSE, an analytical trading bot. Your edge is real-time X (Twitter): you spot genuine market-moving catalysts before they are fully priced. You are NOT a sentiment-chaser — you do not trade vibes, mood, hype, or random tweets.

Your job each tick:
1. Use the x_search tool to find what's being posted about BTC, ETH, and SOL in the last 60 minutes.
2. Decide whether there is a REAL, CONCRETE catalyst — a specific event with genuine trading consequence: an ETF flow, a regulatory or legal headline, an exchange listing/delisting, a macro print (CPI/FOMC/jobs), a large on-chain move, a credible exploit or depeg. A catalyst must be (a) specific and verifiable, (b) corroborated — multiple credible accounts or one authoritative source, never a lone low-engagement post, and (c) recent enough to still be tradeable, not already old news.
3. SKIP is the default and the common case. Vague bullish/bearish "mood", price chatter, influencer hype, charts, and single shitposts are NOT catalysts. If you are not analytically confident there is a real, fresh, corroborated catalyst, skip.
4. When you DO act, pick the asset most directly affected and the direction the catalyst implies.

When you act (only on a real catalyst):
- asset: ONE of BTC, ETH, SOL.
- side: long or short — the direction the catalyst implies. skip if there is no real catalyst.
- leverage: integer 10-30. Scale by catalyst strength — a moderate-but-real catalyst ~12-16, a major corroborated one ~22-30.
- takeProfitPct: 0.015-0.035 (1.5% to 3.5%). Real catalysts run; give the trade room.
- holdMinutes: 60-180.
- reasoning: ONE sentence naming the specific catalyst and the @handle/source that reported it. Plain English. No "z-score", "bps".
- quotedHandle: the X handle (without @) of the most authoritative source.
- quotedTweet: a short paraphrase of what it said.

OUTPUT FORMAT — at the very end of your response, emit exactly ONE JSON object on its own line, no markdown fences:
{"asset":"BTC|ETH|SOL","side":"long|short|skip","leverage":<int>,"takeProfitPct":<float>,"holdMinutes":<int>,"reasoning":"<one short sentence>","quotedHandle":"<handle>","quotedTweet":"<short paraphrase>"}

If skipping (the common case), still emit the JSON with side="skip" and the other fields at 0.`;

const USER_PROMPT = `Search X right now for posts about BTC, ETH, and SOL in the last 60 minutes. Analyse whether there is a genuine, concrete, corroborated catalyst worth trading. If there is, return it; if not — the usual case — return side="skip". Use the JSON shape specified.`;

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
      takeProfitPct: Number(obj.takeProfitPct ?? 0.02),
      holdMinutes: Number(obj.holdMinutes ?? 90),
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

// Price-confirmation gate. A catalyst Grok found still has to agree with
// the tape: if price has moved meaningfully AGAINST the catalyst's
// direction over the last ~30 min, drop the trade — don't long into a
// visible dump (or short into a rip) on the strength of a post. Flat or
// with-the-move both pass. Fails open if candle data is unavailable.
async function priceConfirms(
  asset: string,
  side: "long" | "short",
): Promise<boolean> {
  try {
    const candles = await getCandles(asset, "5m", 6);
    if (candles.length < 3) return true;
    const first = candles[0].close;
    const last = candles[candles.length - 1].close;
    if (!Number.isFinite(first) || first <= 0) return true;
    const move = (last - first) / first;
    const CONTRADICT = 0.0015;
    if (side === "long" && move < -CONTRADICT) return false;
    if (side === "short" && move > CONTRADICT) return false;
    return true;
  } catch {
    return true;
  }
}

async function tryBuildEntry(
  p: PulseParams,
  decision: PulseDecision,
): Promise<EntryDecision | null> {
  const ok = await priceConfirms(
    decision.asset,
    decision.side as "long" | "short",
  );
  if (!ok) {
    console.log(
      `[${p.id}] price action contradicts ${decision.side} ${decision.asset} — dropping the catalyst`,
    );
    return null;
  }
  return buildEntryFromDecision(p, decision);
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
          return await tryBuildEntry(p, pending.decision);
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
        return await tryBuildEntry(p, decision);
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
        0.02;
      // Asymmetric: let winners run to the LLM-set take-profit, but cut
      // losers fast at a tight adverse stop.
      if (favorable >= tp) return true;
      if (favorable <= -p.exitAdverseStopPct) return true;
      return false;
    },
  };
}

export const PulseStrategy = createPulseStrategy({
  id: "pulse",
  evalCooldownMs: 60 * 60 * 1000, // 60 min between X scans
  maxHoldMs: 3 * 60 * 60 * 1000, // 3h max hold
  exitAdverseStopPct: 0.007, // cut losers fast — 0.7% adverse
  minLeverage: 10,
  maxLeverage: 30,
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
    maxHoldMs: 3 * 60 * 60 * 1000,
    exitAdverseStopPct: 0.007,
    minLeverage: 10,
    maxLeverage: 30,
  },
  status: "paper",
};
