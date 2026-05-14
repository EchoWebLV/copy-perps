// lib/bots/narrator.ts
import { generateText } from "ai";
import { xai } from "@ai-sdk/xai";
import { LIQUIDATION_LIZARD_PERSONA } from "./personas/liquidation-lizard";
import { FUNDING_PHOEBE_PERSONA } from "./personas/funding-phoebe";
import { MEAN_REVERT_MIKE_PERSONA } from "./personas/mean-revert-mike";
import { MOMO_MAX_PERSONA } from "./personas/momo-max";
import { VOL_VECTOR_PERSONA } from "./personas/vol-vector";
import { BOOMER_TREND_PERSONA } from "./personas/boomer-trend";

export const PERSONAS = {
  "liquidation-lizard": LIQUIDATION_LIZARD_PERSONA,
  "funding-phoebe": FUNDING_PHOEBE_PERSONA,
  "mean-revert-mike": MEAN_REVERT_MIKE_PERSONA,
  "momo-max": MOMO_MAX_PERSONA,
  "vol-vector": VOL_VECTOR_PERSONA,
  "boomer-trend": BOOMER_TREND_PERSONA,
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
const MODEL_ID = "grok-4.20-non-reasoning";

export async function narrateOpen(args: NarrateOpenArgs): Promise<string> {
  const persona = PERSONAS[args.personaKey];
  if (!persona) throw new Error(`Unknown persona: ${args.personaKey}`);
  const { text } = await generateText({
    model: xai(MODEL_ID),
    system: persona.systemPrompt,
    prompt: JSON.stringify(
      {
        event: "open",
        asset: args.asset,
        side: args.side,
        leverage: args.leverage,
        entry_mark: args.entryMark,
        context: args.trigger,
      },
      null,
      2,
    ),
    maxOutputTokens: 80,
  });
  return text.trim();
}

export async function narrateClose(args: NarrateCloseArgs): Promise<string> {
  const persona = PERSONAS[args.personaKey];
  if (!persona) throw new Error(`Unknown persona: ${args.personaKey}`);
  const { text } = await generateText({
    model: xai(MODEL_ID),
    system: persona.systemPrompt,
    prompt: JSON.stringify(
      {
        event: "close",
        asset: args.asset,
        side: args.side,
        entry_mark: args.entryMark,
        exit_mark: args.exitMark,
        paper_pnl_usd: args.paperPnlUsd,
      },
      null,
      2,
    ),
    maxOutputTokens: 80,
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
