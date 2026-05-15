// lib/bots/thoughts/near-trade.ts
//
// Detector: which bots are CLOSE to firing but haven't? "Close" = the
// strategy-specific signal is within 70-99% of the threshold. We emit at
// most one candidate per bot per tick.
//
// Generator: turn a candidate into an in-character one-liner via xAI.

import { familyOf } from "../wiring";
import { PERSONAS } from "../narrator";
import { generateText } from "ai";
import { xai } from "@ai-sdk/xai";
import type { ExternalSignals } from "../types";
import type { ThoughtCandidate } from "./types";

const MODEL_ID = "grok-4.3";
const NEAR_LOW = 0.7;
const NEAR_HIGH = 0.99;
const LIQUIDATION_FRESH_MS = 60_000;
const LIZARD_MARKETS: ReadonlySet<string> = new Set(["BTC", "ETH", "SOL"]);

interface BotForDetector {
  id: string;
  strategyKey: string;
  config: Record<string, unknown>;
}

export interface DetectNearTradeArgs {
  bots: BotForDetector[];
  signals: ExternalSignals;
}

function readNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function detectNearTradeCandidates(
  args: DetectNearTradeArgs,
): ThoughtCandidate[] {
  const out: ThoughtCandidate[] = [];

  for (const bot of args.bots) {
    const family = familyOf(bot.strategyKey);
    if (!family) continue;

    let cand: ThoughtCandidate | null = null;

    if (family === "funding-phoebe") {
      const threshold = readNumber(bot.config.fundingThreshold, 0.0001);
      const minVenues = readNumber(bot.config.minVenueAgreement, 3);
      for (const [asset, f] of Object.entries(args.signals.funding)) {
        if (f.venuesAgreed < minVenues) continue;
        const mag = Math.abs(f.avgRate);
        const pct = mag / threshold;
        if (pct >= NEAR_LOW && pct < NEAR_HIGH) {
          cand = {
            botId: bot.id,
            kind: "near_trade",
            meta: {
              signalKind: "funding",
              asset,
              currentValue: f.avgRate,
              threshold,
              pctOfThreshold: pct,
            },
          };
          break;
        }
      }
    } else if (family === "liquidation-lizard") {
      const minNotional = readNumber(bot.config.minLiqNotionalUsd, 50_000);
      const now = Date.now();
      for (const liq of args.signals.liquidations) {
        // Match the strategy's staleness + market gates so we don't emit
        // ghost commentary on events the bot can never act on.
        if (now - liq.ts >= LIQUIDATION_FRESH_MS) continue;
        if (!LIZARD_MARKETS.has(liq.asset)) continue;
        const pct = liq.notionalUsd / minNotional;
        if (pct >= NEAR_LOW && pct < NEAR_HIGH) {
          cand = {
            botId: bot.id,
            kind: "near_trade",
            meta: {
              signalKind: "liquidation",
              asset: liq.asset,
              currentValue: liq.notionalUsd,
              threshold: minNotional,
              pctOfThreshold: pct,
            },
          };
          break;
        }
      }
    }
    // momo-max / vol-vector / mean-revert-mike near-detection requires
    // historical candle queries we don't pass into this detector yet.
    // Those families emit no near_trade candidates in the initial cut;
    // the spec marks this as acceptable. Extending later is a follow-up.

    if (cand) out.push(cand);
  }

  return out;
}

export interface GenerateNearTradeArgs {
  personaKey: string;
  meta: Record<string, unknown>;
}

export async function generateNearTradeText(
  args: GenerateNearTradeArgs,
  timeoutMs = 15_000,
): Promise<string | null> {
  const persona = PERSONAS[args.personaKey as keyof typeof PERSONAS];
  if (!persona) return null;

  const prompt = `A signal is forming but has NOT crossed your entry threshold yet.
Details:
  asset: ${args.meta.asset}
  signal_kind: ${args.meta.signalKind}
  current_value: ${args.meta.currentValue}
  threshold: ${args.meta.threshold}
  pct_of_threshold: ${(Number(args.meta.pctOfThreshold) * 100).toFixed(0)}%

Write a single sentence (max ~120 chars) showing you are watching but not
acting yet. Stay in character. No markdown. No quotes around your reply.
Do not start with "I'm watching".`;

  try {
    const { text } = await Promise.race([
      generateText({
        model: xai(MODEL_ID),
        system: persona.systemPrompt,
        prompt,
        maxOutputTokens: 80,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`near-trade timeout ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
    return text.trim();
  } catch (err) {
    console.warn(
      `[thoughts] near-trade gen failed for ${args.personaKey}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
