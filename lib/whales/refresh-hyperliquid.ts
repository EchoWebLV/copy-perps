import {
  getAllMids,
  getClearinghouseState,
  getLeaderboard,
  getUserFillsByTime,
  type HLLeaderboard,
} from "@/lib/hyperliquid/client";
import {
  CURATED_WHALES,
  PINNED_HYPERLIQUID_WHALES,
  truncateEthAddress,
  type CuratedWhale,
} from "@/lib/hyperliquid/whales";
import { selectTradeableWhales } from "@/lib/hyperliquid/leaderboard";
import { cacheGetJson, cacheSetJson } from "@/lib/cache/redis";
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
import { mergeHyperliquidRoster } from "./hyperliquid-roster";
import type { WhalePositionRecord, WhaleRecord } from "./types";

const CLOSE_GRACE_MS = 90_000;
// Hyperliquid rate-limits the info API per IP harder than Pacifica. Keep the
// per-tick clearinghouse fan-out low; the shared hlPace() throttle in the client
// staggers the actual requests, so extra concurrency here only adds queueing.
const POSITION_REFRESH_CONCURRENCY = 3;
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

function isHyperliquidRateLimitError(err: unknown): boolean {
  return err instanceof Error && /\b429\b/.test(err.message);
}

const DISCOVERY_CACHE_KEY = "copy-perps:whales:hyperliquid:discovery:v1";
// The leaderboard ranking is slow-moving, so refresh discovery at most every
// 30 min. Cache-by-volatility: gating the ~30 MB leaderboard pull behind this
// window frees per-tick rate-limit budget for the fast-moving position fetches.
const DISCOVERY_FRESH_MS = 30 * 60_000;
// Keep the last good roster usable for a day so a failed refresh stays sticky
// (serve stale rather than blank) well past the freshness window.
const DISCOVERY_STORE_TTL_SECONDS = 24 * 60 * 60;
// Cap on dynamically discovered whales — bounds per-tick clearinghouse calls so
// we don't regress the Hyperliquid rate-limit budget.
const DISCOVERY_LIMIT = 50;

// Combined refresh roster cap (curated + discovered). Curated whales hold ~94%
// of observed HL open interest, so they must always be tracked; discovery fills
// the rest. Bounds the per-tick clearinghouse fan-out (with the client pacer,
// ~limit * gap of HL traffic per tick). Env-tunable.
const HL_ROSTER_LIMIT = (() => {
  const v = Number(process.env.HL_ROSTER_LIMIT);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 70;
})();

interface DiscoveryCacheEntry {
  refreshedAt: number;
  whales: CuratedWhale[];
}

// Pull the tradeable whale set from Hyperliquid's public leaderboard, cached
// hard because the payload is ~30 MB and the ranking barely moves tick to tick.
// Returns null when discovery is unavailable (failed fetch + no cache) so the
// caller can fall back to the curated roster.
async function getDiscoveredHyperliquidWhales(): Promise<
  CuratedWhale[] | null
> {
  const now = Date.now();
  const cached = await cacheGetJson<DiscoveryCacheEntry>(
    DISCOVERY_CACHE_KEY,
  ).catch(() => null);
  if (cached && now - cached.refreshedAt < DISCOVERY_FRESH_MS) {
    return cached.whales;
  }

  let board: HLLeaderboard;
  try {
    board = await getLeaderboard();
  } catch (err) {
    if (!isHyperliquidRateLimitError(err)) {
      console.warn("[whales] Hyperliquid leaderboard fetch failed:", err);
    }
    // Sticky-on-failure: serve the last good roster if we have one.
    return cached?.whales ?? null;
  }

  const whales = selectTradeableWhales(board.leaderboardRows ?? [], {
    limit: DISCOVERY_LIMIT,
  });
  if (whales.length === 0) {
    return cached?.whales ?? null;
  }

  await cacheSetJson(
    DISCOVERY_CACHE_KEY,
    { refreshedAt: now, whales } satisfies DiscoveryCacheEntry,
    { ttlSeconds: DISCOVERY_STORE_TTL_SECONDS },
  ).catch(() => undefined);
  return whales;
}

// Whale roster for the refresh tick: dynamic leaderboard discovery (plus any
// hand-pinned whales) when available, falling back to the curated roster so the
// feed never goes dark.
async function resolveHyperliquidRoster(): Promise<CuratedWhale[]> {
  const discovered = await getDiscoveredHyperliquidWhales();
  // Track curated AND discovered: curated whales hold the vast majority of live
  // HL positions, while leaderboard discovery (ranked by past PnL) skews to
  // now-flat traders. Merging both — deduped + capped — is what keeps the tape
  // dense instead of swapping the active curated set out for flat winners.
  return mergeHyperliquidRoster(
    CURATED_WHALES,
    PINNED_HYPERLIQUID_WHALES,
    discovered,
    HL_ROSTER_LIMIT,
  );
}

export async function refreshHyperliquidWhales(): Promise<{
  whalesSeen: number;
  positionsSeen: number;
}> {
  const roster = await resolveHyperliquidRoster();
  const uniqueWhales = [
    ...new Map(
      roster.map((whale) => [whale.address.toLowerCase(), whale]),
    ).values(),
  ];
  const mids = await getAllMids().catch(() => ({} as Record<string, string>));

  let positionsSeen = 0;
  let unreachableAccounts = 0;
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
        unreachableAccounts += 1;
        if (!isHyperliquidRateLimitError(err)) {
          console.warn(`[whales] Hyperliquid state failed for ${account}:`, err);
        }
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
      const assetPositions = state.assetPositions ?? [];
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
      // Fills exist only to discover a position's open time. Once that time is
      // confirmed from source and persisted, it never changes — so re-pull fills
      // only when some current position is new or still unconfirmed. Skipping the
      // redundant 90-day fills query spares a per-whale Hyperliquid call that
      // would otherwise contend with the clearinghouse (position) fetch for the
      // shared rate-limit budget.
      const needsOpenTimeDiscovery = assetPositions.some((assetPosition) => {
        const signedSize = Number(assetPosition.position.szi);
        if (!Number.isFinite(signedSize) || signedSize === 0) return true;
        const family = positionFamilyKey({
          market: assetPosition.position.coin,
          side: signedSize > 0 ? "long" : "short",
        });
        const existing =
          family === null ? undefined : existingOpenByFamily.get(family);
        return existing === undefined || !hasKnownHyperliquidOpenTime(existing);
      });
      const sourceFills =
        assetPositions.length === 0 || !needsOpenTimeDiscovery
          ? []
          : await getUserFillsByTime(
              account,
              sourceNow.getTime() - OPEN_TIME_LOOKBACK_MS,
            ).catch((err) => {
              if (!isHyperliquidRateLimitError(err)) {
                console.warn(
                  `[whales] Hyperliquid fills failed for ${account}:`,
                  err,
                );
              }
              return [];
            });
      for (const assetPosition of assetPositions) {
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

  if (unreachableAccounts > 0) {
    console.warn(
      `[whales] Hyperliquid refresh degraded: ${unreachableAccounts}/${uniqueWhales.length} accounts unreachable after retries`,
    );
  }

  return { whalesSeen: uniqueWhales.length, positionsSeen };
}
