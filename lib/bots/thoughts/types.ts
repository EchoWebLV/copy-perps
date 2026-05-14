// lib/bots/thoughts/types.ts
//
// Shared types for the thought-publication subsystem.

export type ThoughtKind =
  | "near_trade"
  | "banter"
  | "market_react"
  | "position_color"
  | "mood_state";

/** A candidate is the detector's output — eligible to be turned into a thought. */
export interface ThoughtCandidate {
  botId: string;
  kind: ThoughtKind;
  /** Free-form metadata the generator + persist layer can use. */
  meta: Record<string, unknown>;
}

/** A thought row after persist. */
export interface PersistedThought {
  id: string;
  botId: string;
  kind: ThoughtKind;
  content: string;
  refMeta: Record<string, unknown> | null;
  createdAt: Date;
}
