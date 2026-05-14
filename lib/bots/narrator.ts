// lib/bots/narrator.ts
import { generateText } from "ai";
import { xai } from "@ai-sdk/xai";
import { LIQUIDATION_LIZARD_PERSONA } from "./personas/liquidation-lizard";

const PERSONAS = {
  "liquidation-lizard": LIQUIDATION_LIZARD_PERSONA,
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
