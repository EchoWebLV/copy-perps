// lib/arena/llm/schema.ts
//
// The structured decision an LLM oracle bot must return. We force a schema via
// the AI SDK's generateObject — never parse prose. `reasoning` is metadata
// (narration + audit); only the post-validation floor (floor.ts) + the on-chain
// apply_decision instruction ever cause a trade. "hold" is a first-class,
// low-friction output so the arena can reward inactivity.

import { z } from "zod";

export const ARENA_ASSETS = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE"] as const;
export type ArenaAsset = (typeof ARENA_ASSETS)[number];

export const actionSchema = z.object({
  action: z.enum(["open", "close", "hold"]),
  // Required for OPEN; ignored for CLOSE/HOLD. Kept required (not optional) so
  // structured-output mode is robust across providers.
  side: z.enum(["long", "short"]),
  asset: z.enum(ARENA_ASSETS),
  leverage: z.number().int().min(1).max(50),
  stakeFracPct: z.number().min(0).max(1),
  // Mandatory, bounded stop. The on-chain floor re-rejects 0 / out-of-range.
  stopLossPct: z.number().min(0).max(0.1),
  takeProfitPct: z.number().min(0).max(0.2),
  confidence: z.number().min(0).max(1),
  // Metadata only (narration + audit; the on-chain tape stores a reason CODE,
  // not this text). Generous cap so thorough reasoning doesn't fail validation
  // and void an otherwise-valid decision.
  reasoning: z.string().max(600),
});

export type LlmAction = z.infer<typeof actionSchema>;

// One tick may emit up to 4 actions (the on-chain position-slot count): e.g.
// close a loser and open two new ideas in a single decision. An empty list is
// a valid do-nothing tick.
export const decisionSchema = z.object({
  actions: z.array(actionSchema).max(4),
});

export type LlmDecision = z.infer<typeof decisionSchema>;

// On-chain encodings (must match arena-program lib.rs DECISION_* + Side).
export const DECISION_ACTION = { hold: 0, open: 1, close: 2 } as const;
export const DECISION_SIDE = { long: 0, short: 1 } as const;

/** Round a 0..1 fraction to integer basis points (0..10000). */
export function toBps(frac: number): number {
  return Math.round(frac * 10_000);
}

/** Round a 0..1 confidence to the on-chain 0..100 scale. */
export function toConfidence100(conf: number): number {
  return Math.round(conf * 100);
}
