import { cacheDelete, cacheGetJson, cacheSetJson } from "@/lib/cache/redis";
import type { WhaleTraderSignal } from "@/lib/types";

type WhaleTraderStats = WhaleTraderSignal["payload"]["stats"];
type StatsByWhaleId = Record<string, WhaleTraderStats>;

export const WHALE_TRADER_STATS_CACHE_KEY = "copy-perps:whales:trader-stats:v1";
// Last-good roster stats are slow-moving and exist only to avoid a cold "+$0"
// first paint after a restart (the in-memory roster cache is wiped on deploy).
// Keep them sticky for a day so a fresh boot always has real numbers to show.
export const WHALE_TRADER_STATS_TTL_SECONDS = 24 * 60 * 60;

async function readRaw(): Promise<StatsByWhaleId> {
  try {
    return (
      (await cacheGetJson<StatsByWhaleId>(WHALE_TRADER_STATS_CACHE_KEY)) ?? {}
    );
  } catch (err) {
    console.warn("[whales] stats cache read failed:", err);
    return {};
  }
}

export async function readWhaleTraderStats(): Promise<
  Map<string, WhaleTraderStats>
> {
  return new Map(Object.entries(await readRaw()));
}

export async function writeWhaleTraderStats(
  statsByWhaleId: StatsByWhaleId,
): Promise<void> {
  if (Object.keys(statsByWhaleId).length === 0) return;
  // Merge so a partial (single-source) refresh never wipes the other source's
  // last-good stats.
  const merged = { ...(await readRaw()), ...statsByWhaleId };
  await cacheSetJson(WHALE_TRADER_STATS_CACHE_KEY, merged, {
    ttlSeconds: WHALE_TRADER_STATS_TTL_SECONDS,
  });
}

export async function clearWhaleTraderStatsForTests(): Promise<void> {
  await cacheDelete(WHALE_TRADER_STATS_CACHE_KEY);
}
