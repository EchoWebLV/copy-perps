import type { WhaleTraderSignal } from "@/lib/types";
import {
  clearStatsBlob,
  loadStatsBlob,
  saveStatsBlob,
  type StatsByWhaleId,
} from "./stats-store";

type WhaleTraderStats = WhaleTraderSignal["payload"]["stats"];

export async function readWhaleTraderStats(): Promise<
  Map<string, WhaleTraderStats>
> {
  try {
    return new Map(Object.entries(await loadStatsBlob()));
  } catch (err) {
    console.warn("[whales] stats cache read failed:", err);
    return new Map();
  }
}

export async function writeWhaleTraderStats(
  statsByWhaleId: StatsByWhaleId,
): Promise<void> {
  if (Object.keys(statsByWhaleId).length === 0) return;
  try {
    // Merge so a partial (single-source) refresh never wipes the other source's
    // last-good stats.
    const merged = { ...(await loadStatsBlob()), ...statsByWhaleId };
    await saveStatsBlob(merged);
  } catch (err) {
    console.warn("[whales] stats cache write failed:", err);
  }
}

export async function clearWhaleTraderStatsForTests(): Promise<void> {
  try {
    await clearStatsBlob();
  } catch {
    // table may not exist yet — nothing to clear
  }
}
