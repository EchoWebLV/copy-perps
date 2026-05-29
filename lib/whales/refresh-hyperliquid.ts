import {
  getAllMids,
  getClearinghouseState,
  getUserFillsByTime,
} from "@/lib/hyperliquid/client";
import { CURATED_WHALES, truncateEthAddress } from "@/lib/hyperliquid/whales";
import {
  isFlashCopyableMarket,
  maxFlashLeverageForMarket,
} from "@/lib/flash/markets";
import { writeWhaleLiveSnapshot } from "./live-cache";
import {
  deriveHyperliquidPositionOpenTime,
  InvalidHyperliquidPositionError,
  makeHyperliquidPositionId,
  mapHyperliquidPosition,
} from "./hyperliquid-source";
import {
  getOpenWhalePositionsForSource,
  markMissingWhalePositionsClosed,
  upsertWhale,
  upsertWhalePosition,
} from "./repository";
import { makeWhaleId } from "./identity";
import type { WhalePositionRecord, WhaleRecord } from "./types";

const CLOSE_GRACE_MS = 90_000;
const POSITION_REFRESH_CONCURRENCY = 6;
const OPEN_TIME_LOOKBACK_MS = 90 * 24 * 60 * 60_000;

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

function readMark(
  mids: Record<string, string>,
  symbol: string,
): number | null {
  const parsed = Number(mids[symbol]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positionFamilyKey(position: {
  market?: string;
  side?: WhalePositionRecord["side"];
}): string | null {
  if (!position.market || !position.side) return null;
  return `${position.market.toUpperCase()}:${position.side}`;
}

function hasKnownHyperliquidOpenTime(position: WhalePositionRecord): boolean {
  return position.raw?.openedAtSource === "source";
}

export async function refreshHyperliquidWhales(): Promise<{
  whalesSeen: number;
  positionsSeen: number;
}> {
  const uniqueWhales = [
    ...new Map(
      CURATED_WHALES.map((whale) => [whale.address.toLowerCase(), whale]),
    ).values(),
  ];
  const mids = await getAllMids().catch(() => ({} as Record<string, string>));

  let positionsSeen = 0;
  const snapshotObservedAt = new Date();
  const snapshotAccounts: string[] = [];
  const snapshotWhales: WhaleRecord[] = [];
  const snapshotPositions: WhalePositionRecord[] = [];

  await forEachWithConcurrency(
    uniqueWhales,
    POSITION_REFRESH_CONCURRENCY,
    async (curated) => {
      const account = curated.address.toLowerCase();
      const whaleId = makeWhaleId("hyperliquid", account);
      const displayName =
        curated.label ?? `HL ${truncateEthAddress(account)}`;

      await upsertWhale({
        id: whaleId,
        source: "hyperliquid",
        sourceAccount: account,
        displayName,
        avatarUrl: null,
        tags: ["hyperliquid"],
      });

      let state;
      try {
        state = await getClearinghouseState(account);
      } catch (err) {
        console.warn(`[whales] Hyperliquid state failed for ${account}:`, err);
        return;
      }

      snapshotAccounts.push(account);
      snapshotWhales.push({
        id: whaleId,
        source: "hyperliquid",
        sourceAccount: account,
        displayName,
        avatarUrl: null,
        status: "active",
        tags: ["hyperliquid"],
        createdAt: snapshotObservedAt,
        updatedAt: snapshotObservedAt,
      });

      const openPositionIds: string[] = [];
      const now = new Date(state.time);
      const sourceNow = Number.isNaN(now.getTime()) ? snapshotObservedAt : now;
      const sourceFills =
        (state.assetPositions ?? []).length === 0
          ? []
          : await getUserFillsByTime(
              account,
              sourceNow.getTime() - OPEN_TIME_LOOKBACK_MS,
            ).catch((err) => {
              console.warn(
                `[whales] Hyperliquid fills failed for ${account}:`,
                err,
              );
              return [];
            });
      const existingOpenPositions = await getOpenWhalePositionsForSource({
        source: "hyperliquid",
        sourceAccount: account,
      }).catch(() => []);
      const existingOpenById = new Map(
        existingOpenPositions.map((position) => [position.id, position]),
      );
      const existingOpenByFamily = new Map(
        existingOpenPositions.flatMap((position) => {
          const key = positionFamilyKey(position);
          return key === null ? [] : [[key, position]];
        }),
      );
      for (const assetPosition of state.assetPositions ?? []) {
        try {
          const mapped = mapHyperliquidPosition({
            sourceAccount: account,
            assetPosition,
            currentMark: readMark(mids, assetPosition.position.coin),
            now: sourceNow,
            copyableOnPacifica: isFlashCopyableMarket(
              assetPosition.position.coin,
            ),
            pacificaMaxLeverage: maxFlashLeverageForMarket(
              assetPosition.position.coin,
            ),
          });
          const fillOpenedAtMs = deriveHyperliquidPositionOpenTime({
            coin: mapped.market,
            side: mapped.side,
            fills: sourceFills,
          });
          const existing =
            existingOpenById.get(mapped.id) ??
            existingOpenByFamily.get(positionFamilyKey(mapped) ?? "");
          let openedAtSource: "source" | "observed" = "observed";
          if (fillOpenedAtMs !== null) {
            mapped.openedAt = new Date(fillOpenedAtMs);
            openedAtSource = "source";
          } else if (existing) {
            mapped.openedAt = existing.openedAt;
            openedAtSource = hasKnownHyperliquidOpenTime(existing)
              ? "source"
              : "observed";
          }
          mapped.raw = {
            ...mapped.raw,
            openedAtSource,
          };
          mapped.id = makeHyperliquidPositionId({
            sourceAccount: account,
            market: mapped.market,
            side: mapped.side,
            openedAtMs: mapped.openedAt.getTime(),
            entryPrice: mapped.entryPrice,
          });
          await upsertWhalePosition(mapped);
          openPositionIds.push(mapped.id);
          snapshotPositions.push(mapped);
          positionsSeen += 1;
        } catch (err) {
          if (err instanceof InvalidHyperliquidPositionError) {
            console.warn(
              `[whales] skipping invalid Hyperliquid position for ${account}:`,
              err,
            );
            continue;
          }
          throw err;
        }
      }

      await markMissingWhalePositionsClosed({
        source: "hyperliquid",
        sourceAccount: account,
        openPositionIds,
        graceCutoff: new Date(Date.now() - CLOSE_GRACE_MS),
      });
    },
  );

  if (snapshotAccounts.length > 0) {
    try {
      await writeWhaleLiveSnapshot({
        source: "hyperliquid",
        observedAt: snapshotObservedAt,
        accounts: snapshotAccounts,
        whales: snapshotWhales,
        positions: snapshotPositions,
      });
    } catch (err) {
      console.warn("[whales] Hyperliquid live cache write failed:", err);
    }
  }

  return { whalesSeen: uniqueWhales.length, positionsSeen };
}
