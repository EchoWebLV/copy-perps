import { makeWhaleId } from "./identity";
import { writeWhaleLiveSnapshot } from "./live-cache";
import { OSTIUM_MAPPED_PAIR_IDS } from "./ostium-markets";
import {
  InvalidOstiumTradeError,
  mapOstiumTrade,
  ostiumDisplayName,
} from "./ostium-source";
import { fetchOstiumTopTradesByMarket } from "./ostium-subgraph";
import {
  markMissingWhalePositionsClosed,
  upsertWhale,
  upsertWhalePosition,
} from "./repository";
import type { WhalePositionRecord, WhaleRecord } from "./types";

const CLOSE_GRACE_MS = 90_000;
const TOP_PER_MARKET = (() => {
  const parsed = Number(process.env.OSTIUM_TOP_PER_MARKET);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 15;
})();

export async function refreshOstiumWhales(): Promise<{
  whalesSeen: number;
  positionsSeen: number;
}> {
  let rawTrades;
  try {
    rawTrades = await fetchOstiumTopTradesByMarket(
      OSTIUM_MAPPED_PAIR_IDS,
      TOP_PER_MARKET,
    );
  } catch (err) {
    console.warn("[whales] Ostium subgraph fetch failed:", err);
    return { whalesSeen: 0, positionsSeen: 0 };
  }

  const now = new Date();
  const byAccount = new Map<string, WhalePositionRecord[]>();
  for (const trade of rawTrades) {
    let mapped: WhalePositionRecord;
    try {
      mapped = mapOstiumTrade({ trade, now });
    } catch (err) {
      if (err instanceof InvalidOstiumTradeError) continue;
      throw err;
    }
    const list = byAccount.get(mapped.sourceAccount) ?? [];
    list.push(mapped);
    byAccount.set(mapped.sourceAccount, list);
  }

  const observedAt = now;
  const snapshotAccounts: string[] = [];
  const snapshotWhales: WhaleRecord[] = [];
  const snapshotPositions: WhalePositionRecord[] = [];
  let positionsSeen = 0;

  for (const [account, positions] of byAccount) {
    const displayName = ostiumDisplayName(account);
    const whaleId = makeWhaleId("ostium", account);
    const tags = ["ostium"];

    await upsertWhale({
      id: whaleId,
      source: "ostium",
      sourceAccount: account,
      displayName,
      avatarUrl: null,
      tags,
    });

    const openPositionIds: string[] = [];
    for (const position of positions) {
      await upsertWhalePosition(position);
      openPositionIds.push(position.id);
      snapshotPositions.push(position);
      positionsSeen += 1;
    }

    await markMissingWhalePositionsClosed({
      source: "ostium",
      sourceAccount: account,
      openPositionIds,
      graceCutoff: new Date(Date.now() - CLOSE_GRACE_MS),
    });

    snapshotAccounts.push(account);
    snapshotWhales.push({
      id: whaleId,
      source: "ostium",
      sourceAccount: account,
      displayName,
      avatarUrl: null,
      status: "active",
      tags,
      createdAt: observedAt,
      updatedAt: observedAt,
    });
  }

  if (snapshotAccounts.length > 0) {
    try {
      await writeWhaleLiveSnapshot({
        source: "ostium",
        observedAt,
        accounts: snapshotAccounts,
        whales: snapshotWhales,
        positions: snapshotPositions,
      });
    } catch (err) {
      console.warn("[whales] Ostium live cache write failed:", err);
    }
  }

  return { whalesSeen: byAccount.size, positionsSeen };
}
