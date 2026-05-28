import { getLeaderboard, getMarkets, getPositions } from "@/lib/pacifica/client";
import { filterTradeable, preRankByActivity } from "@/lib/pacifica/leaderboard";
import { getMarksSnapshot } from "@/lib/data/marks";
import { maxFlashLeverageForMarket } from "@/lib/flash/markets";
import { generatedWhaleHandle, makeWhaleId } from "./identity";
import { writeWhaleLiveSnapshot } from "./live-cache";
import {
  InvalidPacificaPositionError,
  mapPacificaPosition,
} from "./pacifica-source";
import { CURATED_PACIFICA_WHALES } from "./curated";
import {
  markMissingPacificaPositionsClosed,
  upsertWhale,
  upsertWhalePosition,
} from "./repository";
import type { WhalePositionRecord, WhaleRecord } from "./types";

const LEADERBOARD_LIMIT = 30;
const CLOSE_GRACE_MS = 90_000;
const POSITION_REFRESH_CONCURRENCY = 6;

async function forEachWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) return;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function validMaxLeverage(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

export async function refreshPacificaWhales(): Promise<{
  whalesSeen: number;
  positionsSeen: number;
}> {
  const [leaderboard, markets, marks] = await Promise.all([
    getLeaderboard(),
    getMarkets(),
    getMarksSnapshot(),
  ]);

  const marketMaxLeverage = new Map(
    markets.map((market) => [
      market.symbol,
      validMaxLeverage(market.max_leverage),
    ]),
  );
  const curatedByAccount = new Map(
    CURATED_PACIFICA_WHALES.map((whale) => [whale.sourceAccount, whale]),
  );
  const leaderboardByAccount = new Map(
    leaderboard.map((entry) => [entry.address, entry]),
  );
  const tradeable = preRankByActivity(filterTradeable(leaderboard)).slice(
    0,
    LEADERBOARD_LIMIT,
  );
  const accounts = [
    ...CURATED_PACIFICA_WHALES.map((whale) => whale.sourceAccount),
    ...tradeable.map((entry) => entry.address),
  ];
  const uniqueAccounts = [...new Set(accounts)];

  let positionsSeen = 0;
  const snapshotObservedAt = new Date();
  const snapshotAccounts: string[] = [];
  const snapshotWhales: WhaleRecord[] = [];
  const snapshotPositions: WhalePositionRecord[] = [];

  await forEachWithConcurrency(
    uniqueAccounts,
    POSITION_REFRESH_CONCURRENCY,
    async (account) => {
      const curated = curatedByAccount.get(account);
      const leaderboardEntry = leaderboardByAccount.get(account);
      const whaleId = makeWhaleId("pacifica", account);
      const displayName =
        (curated?.displayName ?? leaderboardEntry?.username) ||
        generatedWhaleHandle(account);
      const avatarUrl = curated?.avatarUrl ?? null;
      const tags = curated?.tags ?? [];

      await upsertWhale({
        id: whaleId,
        source: "pacifica",
        sourceAccount: account,
        displayName,
        avatarUrl,
        tags,
      });

      let sourcePositions;
      try {
        sourcePositions = await getPositions(account);
      } catch (err) {
        console.warn(`[whales] Pacifica positions failed for ${account}:`, err);
        return;
      }

      snapshotAccounts.push(account);
      snapshotWhales.push({
        id: whaleId,
        source: "pacifica",
        sourceAccount: account,
        displayName,
        avatarUrl,
        status: "active",
        tags,
        createdAt: snapshotObservedAt,
        updatedAt: snapshotObservedAt,
      });

      const openPositionIds: string[] = [];
      const now = new Date();
      for (const position of sourcePositions) {
        try {
          const mapped = mapPacificaPosition({
            sourceAccount: account,
            position,
            marketMaxLeverage:
              maxFlashLeverageForMarket(position.symbol) ??
              marketMaxLeverage.get(position.symbol) ??
              1,
            currentMark: marks.get(position.symbol) ?? null,
            now,
          });
          await upsertWhalePosition(mapped);
          openPositionIds.push(mapped.id);
          snapshotPositions.push(mapped);
          positionsSeen += 1;
        } catch (err) {
          if (err instanceof InvalidPacificaPositionError) {
            console.warn(
              `[whales] skipping invalid Pacifica position for ${account}:`,
              err,
            );
            continue;
          }
          throw err;
        }
      }

      await markMissingPacificaPositionsClosed({
        sourceAccount: account,
        openPositionIds,
        graceCutoff: new Date(Date.now() - CLOSE_GRACE_MS),
      });
    },
  );

  if (snapshotAccounts.length > 0) {
    try {
      await writeWhaleLiveSnapshot({
        source: "pacifica",
        observedAt: snapshotObservedAt,
        accounts: snapshotAccounts,
        whales: snapshotWhales,
        positions: snapshotPositions,
      });
    } catch (err) {
      console.warn("[whales] live cache write failed:", err);
    }
  }

  return { whalesSeen: uniqueAccounts.length, positionsSeen };
}
