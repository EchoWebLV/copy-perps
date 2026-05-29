const ENTRY_COST_OPEN_TIME_TOLERANCE_MS = 5 * 60 * 1000;

export interface FlashEntryCostPosition {
  positionPubkey?: string | null;
  openTime?: number | null;
  entryCostUsd?: number | null;
  openFeeUsd?: number | null;
}

export interface FlashEntryCostSnapshot {
  positionPubkey: string;
  openTime: number | null;
  entryCostUsd?: number;
  openFeeUsd?: number;
}

export type FlashEntryCostCache = Map<string, FlashEntryCostSnapshot>;

function finiteNumber(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function positionKey(position: FlashEntryCostPosition): string | null {
  return typeof position.positionPubkey === "string" &&
    position.positionPubkey.length > 0
    ? position.positionPubkey
    : null;
}

function hasEntryCost(position: FlashEntryCostPosition): boolean {
  const entryCostUsd = finiteNumber(position.entryCostUsd);
  const openFeeUsd = finiteNumber(position.openFeeUsd);
  return (
    (entryCostUsd != null && entryCostUsd > 0) ||
    (openFeeUsd != null && openFeeUsd >= 0)
  );
}

function compatibleOpenTime(
  snapshot: FlashEntryCostSnapshot,
  position: FlashEntryCostPosition,
): boolean {
  const snapshotOpenTime = finiteNumber(snapshot.openTime);
  const positionOpenTime = finiteNumber(position.openTime);
  if (snapshotOpenTime == null || positionOpenTime == null) return true;
  return (
    Math.abs(snapshotOpenTime - positionOpenTime) <=
    ENTRY_COST_OPEN_TIME_TOLERANCE_MS
  );
}

export function rememberFlashEntryCost(
  cache: FlashEntryCostCache,
  position: FlashEntryCostPosition,
): void {
  const key = positionKey(position);
  if (!key || !hasEntryCost(position)) return;

  const entryCostUsd = finiteNumber(position.entryCostUsd);
  const openFeeUsd = finiteNumber(position.openFeeUsd);
  cache.set(key, {
    positionPubkey: key,
    openTime: finiteNumber(position.openTime),
    ...(entryCostUsd != null && entryCostUsd > 0 ? { entryCostUsd } : {}),
    ...(openFeeUsd != null && openFeeUsd >= 0 ? { openFeeUsd } : {}),
  });
}

export function forgetFlashEntryCost(
  cache: FlashEntryCostCache,
  position: FlashEntryCostPosition,
): void {
  const key = positionKey(position);
  if (key) cache.delete(key);
}

export function pruneFlashEntryCostCache(
  cache: FlashEntryCostCache,
  positions: FlashEntryCostPosition[],
): void {
  const openKeys = new Set(positions.map(positionKey).filter(Boolean));
  for (const key of cache.keys()) {
    if (!openKeys.has(key)) cache.delete(key);
  }
}

export function mergeFlashEntryCostCache<
  T extends FlashEntryCostPosition,
>(cache: FlashEntryCostCache, positions: T[]): T[] {
  return positions.map((position) => {
    if (hasEntryCost(position)) return position;

    const key = positionKey(position);
    const snapshot = key ? cache.get(key) : undefined;
    if (!snapshot || !compatibleOpenTime(snapshot, position)) return position;

    return {
      ...position,
      entryCostUsd: snapshot.entryCostUsd,
      openFeeUsd: snapshot.openFeeUsd,
    };
  });
}

export function serializeFlashEntryCostCache(
  cache: FlashEntryCostCache,
): FlashEntryCostSnapshot[] {
  return Array.from(cache.values());
}

export function deserializeFlashEntryCostCache(
  value: unknown,
): FlashEntryCostCache {
  const cache: FlashEntryCostCache = new Map();
  if (!Array.isArray(value)) return cache;

  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const position = item as FlashEntryCostSnapshot;
    rememberFlashEntryCost(cache, position);
  }

  return cache;
}
