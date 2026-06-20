// lib/arena/llm/thoughts.ts
//
// Client-safe shapes + pure join logic for the "AI thought behind the trade".
// NO db import here on purpose — the browser bundle and the unit tests both
// pull from this module; the server-only persistence lives in decision-store.ts.

/** One persisted oracle-bot decision, as served to the client. */
export interface ArenaThought {
  persona: string;
  action: "open" | "close" | "hold";
  side: "long" | "short" | null;
  asset: string | null;
  leverage: number | null;
  confidence: number | null; // 0..1
  reasoning: string;
  sent: boolean;
  rejectReason: string | null;
  signature: string | null;
  /** Epoch ms of the on-chain tape entry this decision wrote (join key). */
  tapeTsMs: number | null;
  createdAtMs: number;
}

/**
 * Index a bot's thoughts by the on-chain tape entry they produced, for an exact
 * join to a decoded ArenaTapeEntry.tsMs. Only `sent` decisions carry a tapeTsMs
 * (HOLD/skip made no tape entry), so those are the only ones that land in the
 * map. If two thoughts somehow share a tapeTsMs, the newest (by createdAtMs)
 * wins — defensive against a re-submit writing a duplicate row.
 */
export function indexThoughtsByTape(
  thoughts: ArenaThought[],
): Map<number, ArenaThought> {
  const map = new Map<number, ArenaThought>();
  for (const t of thoughts) {
    if (t.tapeTsMs == null) continue;
    const prev = map.get(t.tapeTsMs);
    if (!prev || t.createdAtMs > prev.createdAtMs) map.set(t.tapeTsMs, t);
  }
  return map;
}
