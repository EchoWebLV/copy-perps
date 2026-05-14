// lib/bots/cross-bot.ts
//
// Snapshot of all paper bots' open positions, grouped by (asset, side) and
// by asset. The resolver consumes this for pileup prevention (don't open
// the 4th bot on the same side of the same asset). The signal generator
// consumes it for the disagreement-linking UI on bot cards.
//
// Cached 5s — fresh enough that pileup checks see recently-opened positions
// from earlier in the same tick chain, cheap enough that it doesn't dominate
// the resolver loop.

import { db } from "@/lib/db";
import { paperPositions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export interface CrossBotSnapshot {
  /** key: `${asset}|${side}` → count of bots holding that exact side on that asset */
  positionsByAssetSide: Map<string, number>;
  /** asset → array of (botId, side) entries; useful for disagreement queries */
  botsByAsset: Map<string, Array<{ botId: string; side: "long" | "short" }>>;
}

const TTL_MS = 5_000;
let _cache: { snap: CrossBotSnapshot; expiresAt: number } | null = null;

export async function getCrossBotSnapshot(): Promise<CrossBotSnapshot> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.snap;

  const rows = await db
    .select()
    .from(paperPositions)
    .where(eq(paperPositions.status, "open"));

  const positionsByAssetSide = new Map<string, number>();
  const botsByAsset = new Map<string, Array<{ botId: string; side: "long" | "short" }>>();

  for (const r of rows) {
    const side = r.side as "long" | "short";
    const key = `${r.asset}|${side}`;
    positionsByAssetSide.set(key, (positionsByAssetSide.get(key) ?? 0) + 1);
    const list = botsByAsset.get(r.asset) ?? [];
    list.push({ botId: r.botId, side });
    botsByAsset.set(r.asset, list);
  }

  const snap: CrossBotSnapshot = { positionsByAssetSide, botsByAsset };
  _cache = { snap, expiresAt: Date.now() + TTL_MS };
  return snap;
}

/** Test-only: clear the cache between runs. Don't call from production code. */
export function _clearCrossBotCache(): void {
  _cache = null;
}
