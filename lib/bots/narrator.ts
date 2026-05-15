// lib/bots/narrator.ts
import { generateText } from "ai";
import { xai } from "@ai-sdk/xai";
import { LIQUIDATION_LIZARD_PERSONA } from "./personas/liquidation-lizard";
import { FUNDING_PHOEBE_PERSONA } from "./personas/funding-phoebe";
import { MEAN_REVERT_MIKE_PERSONA } from "./personas/mean-revert-mike";
import { MOMO_MAX_PERSONA } from "./personas/momo-max";
import { VOL_VECTOR_PERSONA } from "./personas/vol-vector";
import { BOOMER_TREND_PERSONA } from "./personas/boomer-trend";
import { ANTI_SURGE_PERSONA } from "./personas/anti-surge";
import { ANTI_FADE_PERSONA } from "./personas/anti-fade";

export const PERSONAS = {
  "liquidation-lizard": LIQUIDATION_LIZARD_PERSONA,
  "funding-phoebe": FUNDING_PHOEBE_PERSONA,
  "mean-revert-mike": MEAN_REVERT_MIKE_PERSONA,
  "momo-max": MOMO_MAX_PERSONA,
  "vol-vector": VOL_VECTOR_PERSONA,
  "boomer-trend": BOOMER_TREND_PERSONA,
  "anti-surge": ANTI_SURGE_PERSONA,
  "anti-fade": ANTI_FADE_PERSONA,
} as const;

export type PersonaKey = keyof typeof PERSONAS;

export interface NarrateOpenArgs {
  personaKey: PersonaKey;
  asset: string;
  side: "long" | "short";
  leverage: number;
  entryMark: number;
  trigger: Record<string, unknown>;
}

export interface NarrateCloseArgs {
  personaKey: PersonaKey;
  asset: string;
  side: "long" | "short";
  entryMark: number;
  exitMark: number;
  paperPnlUsd: number;
}

// Matches the model already in use in app/api/analyze/route.ts.
const MODEL_ID = "grok-4.3";

// Render the strategy's triggerMeta into a single human-readable line.
// Goal: plain English a non-trader can parse. Numbers stay (the persona
// prompt requires Grok quote at least one), but they're framed as
// percent moves, volume jumps, or "X% above average" — never z-scores,
// sigmas, or raw "realized vol" jargon. The strategy machinery uses
// those concepts internally; the narration must hide them.
function formatTriggerSummary(
  personaKey: string,
  asset: string,
  side: "long" | "short",
  trigger: Record<string, unknown>,
): string {
  if (personaKey === "momo-max") {
    const breakout = Number(trigger.breakoutPct ?? 0);
    const volRatio = Number(trigger.volumeRatio ?? 0);
    const direction = breakout >= 0 ? "jumped" : "dropped";
    return `${asset} just ${direction} ${Math.abs(breakout * 100).toFixed(2)}% in one minute on ${volRatio.toFixed(1)}× normal trading volume. You opened a ${side}.`;
  }
  if (personaKey === "mean-revert-mike") {
    const pctFromMean = Number(trigger.pctFromMean ?? 0);
    const direction = pctFromMean >= 0 ? "above" : "below";
    return `${asset} is sitting ${Math.abs(pctFromMean * 100).toFixed(2)}% ${direction} its 20-minute average — unusually stretched. You opened a ${side} betting it snaps back.`;
  }
  if (personaKey === "vol-vector") {
    const ratio = Number(trigger.ratio ?? 0);
    const up = Number(trigger.upFrac ?? 0);
    const down = Number(trigger.downFrac ?? 0);
    const dir = up > down ? "up" : "down";
    const directional = Math.round(100 * Math.max(up, down));
    return `${asset}'s price is swinging ${ratio.toFixed(1)}× harder than usual, and ${directional}% of recent moves went ${dir}. You opened a ${side}.`;
  }
  if (personaKey === "anti-surge") {
    const breakout = Number(trigger.breakoutPct ?? 0);
    const volRatio = Number(trigger.volumeRatio ?? 0);
    const surgeSide = trigger.flippedFromSide === "long" ? "long" : "short";
    const direction = breakout >= 0 ? "jump" : "drop";
    return `Surge just opened a ${surgeSide} on ${asset} chasing a ${Math.abs(breakout * 100).toFixed(2)}% ${direction} on ${volRatio.toFixed(1)}× volume. You're fading that chase — opened the opposite ${side}.`;
  }
  if (personaKey === "anti-fade") {
    const pctFromMean = Number(trigger.pctFromMean ?? 0);
    const direction = pctFromMean >= 0 ? "above" : "below";
    const fadeAction =
      trigger.flippedFromSide === "short" ? "shorting" : "longing";
    return `Fade is ${fadeAction} ${asset} because it's ${Math.abs(pctFromMean * 100).toFixed(2)}% ${direction} its 20-minute average. You're riding the move instead — opened a ${side}.`;
  }
  return `Opened ${side} on ${asset}.`;
}

export async function narrateOpen(args: NarrateOpenArgs): Promise<string> {
  const persona = PERSONAS[args.personaKey];
  if (!persona) throw new Error(`Unknown persona: ${args.personaKey}`);
  const triggerSummary = formatTriggerSummary(
    args.personaKey,
    args.asset,
    args.side,
    args.trigger,
  );
  const { text } = await generateText({
    model: xai(MODEL_ID),
    system: persona.systemPrompt,
    prompt: [
      `Event: opened a paper position.`,
      `Asset: ${args.asset}`,
      `Side: ${args.side}`,
      `Leverage: ${args.leverage}x`,
      `Entry mark: ${args.entryMark}`,
      ``,
      `Trigger (the precise reason you fired):`,
      triggerSummary,
      ``,
      `Write ONE short, in-voice sentence (max ~18 words) explaining this trade to a normal person who doesn't know trading jargon. It MUST quote at least one specific number from the trigger above — a percent move, a volume multiple, or a percent-from-average. NEVER use the words "z-score", "sigma", "σ", "standard deviation", "realized vol", "basis points", or "bps". Translate them into plain English ("2% above average", "swings are 3× louder than normal"). No financial advice, no markdown, no quotes, no preamble.`,
    ].join("\n"),
    maxOutputTokens: 110,
  });
  return text.trim();
}

export async function narrateClose(args: NarrateCloseArgs): Promise<string> {
  const persona = PERSONAS[args.personaKey];
  if (!persona) throw new Error(`Unknown persona: ${args.personaKey}`);
  const movePct =
    args.entryMark > 0
      ? ((args.exitMark - args.entryMark) / args.entryMark) * 100
      : 0;
  const winning = args.paperPnlUsd >= 0;
  const { text } = await generateText({
    model: xai(MODEL_ID),
    system: persona.systemPrompt,
    prompt: [
      `Event: closed a paper position.`,
      `Asset: ${args.asset}`,
      `Side: ${args.side}`,
      `Entry mark: ${args.entryMark}`,
      `Exit mark: ${args.exitMark}`,
      `Underlying move: ${movePct >= 0 ? "+" : ""}${movePct.toFixed(2)}%`,
      `Paper PnL: ${winning ? "+" : "-"}$${Math.abs(args.paperPnlUsd).toFixed(2)}`,
      ``,
      `Write ONE short, in-voice sentence about this close. Quote the PnL OR the move percent. ${winning ? "Take credit (in character)" : "Acknowledge the loss without whining"}. No financial advice, no markdown, no quotes, no preamble.`,
    ].join("\n"),
    maxOutputTokens: 110,
  });
  return text.trim();
}

function isKnownPersona(key: string): key is PersonaKey {
  return key in PERSONAS;
}

// Deterministic fallbacks used when xAI is unreachable. The whole point of
// the Chatter feed is the bot's voice — but a flat templated string still
// beats silence. These fire only when narrateOpenSafe / narrateCloseSafe
// return null (timeout, persona miss, API failure).
export function narrateOpenFallback(args: {
  asset: string;
  side: "long" | "short";
  leverage: number;
  entryMark: number;
}): string {
  const verb = args.side === "long" ? "Opening long" : "Shorting";
  return `${verb} ${args.asset} ${args.leverage}x at ${args.entryMark.toFixed(args.entryMark >= 100 ? 2 : 4)}.`;
}

export function narrateCloseFallback(args: {
  asset: string;
  side: "long" | "short";
  paperPnlUsd: number;
}): string {
  const winning = args.paperPnlUsd >= 0;
  const sign = winning ? "+" : "-";
  const amt = Math.abs(args.paperPnlUsd).toFixed(2);
  if (winning) {
    return `Closed ${args.side} ${args.asset} for ${sign}$${amt}. Cycle complete.`;
  }
  return `Cut ${args.side} ${args.asset} at ${sign}$${amt}. Moving on.`;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`narrator timeout ${ms}ms`)), ms),
    ),
  ]);
}

// Safe wrappers used by the resolver. Never throw, never block the tick
// indefinitely. Return null on timeout / unknown persona / xAI failure
// so the position still lands; the UI handles missing narration.
export async function narrateOpenSafe(
  args: Omit<NarrateOpenArgs, "personaKey"> & { personaKey: string },
  timeoutMs = 15000,
): Promise<string | null> {
  if (!isKnownPersona(args.personaKey)) return null;
  try {
    return await withTimeout(
      narrateOpen({ ...args, personaKey: args.personaKey }),
      timeoutMs,
    );
  } catch (err) {
    console.warn(
      `[narrator] open failed for ${args.personaKey}/${args.asset}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function narrateCloseSafe(
  args: Omit<NarrateCloseArgs, "personaKey"> & { personaKey: string },
  timeoutMs = 15000,
): Promise<string | null> {
  if (!isKnownPersona(args.personaKey)) return null;
  try {
    return await withTimeout(
      narrateClose({ ...args, personaKey: args.personaKey }),
      timeoutMs,
    );
  } catch (err) {
    console.warn(
      `[narrator] close failed for ${args.personaKey}/${args.asset}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
