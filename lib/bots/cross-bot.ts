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
import { bots, paperPositions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { familyOf } from "./wiring";

export interface CrossBotSnapshot {
  /** key: `${asset}|${side}` → count of bots holding that exact side on that asset */
  positionsByAssetSide: Map<string, number>;
  /** asset → array of (botId, side, family) entries; useful for disagreement queries */
  botsByAsset: Map<
    string,
    Array<{ botId: string; side: "long" | "short"; family: string | null }>
  >;
  /**
   * key: `${family}|${asset}|${side}` → true if any bot in that family is
   * already holding that exact side on that asset. Resolver uses this to skip
   * duplicate entries from sibling variants (Phoebe + Phoebe Lite both
   * shorting AVAX is the same trade twice).
   */
  familyHoldings: Set<string>;
}

const TTL_MS = 5_000;
let _cache: { snap: CrossBotSnapshot; expiresAt: number } | null = null;

export async function getCrossBotSnapshot(): Promise<CrossBotSnapshot> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.snap;

  const rows = await db
    .select()
    .from(paperPositions)
    .where(eq(paperPositions.status, "open"));

  // Pull bot rows so we can resolve each position's strategyKey → family.
  // One query rather than per-row lookups; the roster is small (~12).
  const botRows = await db.select().from(bots);
  const strategyByBot = new Map(botRows.map((b) => [b.id, b.strategyKey]));

  const positionsByAssetSide = new Map<string, number>();
  const botsByAsset = new Map<
    string,
    Array<{ botId: string; side: "long" | "short"; family: string | null }>
  >();
  const familyHoldings = new Set<string>();

  for (const r of rows) {
    const side = r.side as "long" | "short";
    const key = `${r.asset}|${side}`;
    positionsByAssetSide.set(key, (positionsByAssetSide.get(key) ?? 0) + 1);
    const strategyKey = strategyByBot.get(r.botId) ?? null;
    const family = strategyKey ? familyOf(strategyKey) : null;
    const list = botsByAsset.get(r.asset) ?? [];
    list.push({ botId: r.botId, side, family });
    botsByAsset.set(r.asset, list);
    if (family) familyHoldings.add(`${family}|${r.asset}|${side}`);
  }

  const snap: CrossBotSnapshot = {
    positionsByAssetSide,
    botsByAsset,
    familyHoldings,
  };
  _cache = { snap, expiresAt: Date.now() + TTL_MS };
  return snap;
}

/** Test-only: clear the cache between runs. Don't call from production code. */
export function _clearCrossBotCache(): void {
  _cache = null;
}
