import {
  cacheDelete,
  cacheGetJson,
  cacheSetJson,
} from "@/lib/cache/redis";
import { WHALE_SOURCE_MAX_AGE_MS } from "./identity";
import type { WhalePositionRecord, WhaleRecord, WhaleSource } from "./types";

export const WHALE_LIVE_CACHE_KEY = "copy-perps:whales:pacifica:live:v1";
export const WHALE_LIVE_CACHE_TTL_SECONDS =
  Math.ceil(WHALE_SOURCE_MAX_AGE_MS / 1000) + 15;

export interface WhaleLiveSnapshot {
  source: WhaleSource | "multi";
  observedAt: Date;
  accounts: string[];
  whales: WhaleRecord[];
  positions: WhalePositionRecord[];
}

type SerializedWhale = Omit<WhaleRecord, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

type SerializedPosition = Omit<
  WhalePositionRecord,
  "openedAt" | "closedAt" | "lastSeenAt"
> & {
  openedAt: string;
  closedAt: string | null;
  lastSeenAt: string;
};

type SerializedSnapshot = Omit<
  WhaleLiveSnapshot,
  "observedAt" | "whales" | "positions"
> & {
  observedAt: string;
  whales: SerializedWhale[];
  positions: SerializedPosition[];
};

function serializeWhale(whale: WhaleRecord): SerializedWhale {
  return {
    ...whale,
    createdAt: whale.createdAt.toISOString(),
    updatedAt: whale.updatedAt.toISOString(),
  };
}

function deserializeWhale(whale: SerializedWhale): WhaleRecord {
  return {
    ...whale,
    createdAt: new Date(whale.createdAt),
    updatedAt: new Date(whale.updatedAt),
  };
}

function serializePosition(position: WhalePositionRecord): SerializedPosition {
  return {
    ...position,
    openedAt: position.openedAt.toISOString(),
    closedAt: position.closedAt?.toISOString() ?? null,
    lastSeenAt: position.lastSeenAt.toISOString(),
  };
}

function deserializePosition(
  position: SerializedPosition,
): WhalePositionRecord {
  return {
    ...position,
    openedAt: new Date(position.openedAt),
    closedAt: position.closedAt === null ? null : new Date(position.closedAt),
    lastSeenAt: new Date(position.lastSeenAt),
  };
}

function serializeSnapshot(snapshot: WhaleLiveSnapshot): SerializedSnapshot {
  return {
    ...snapshot,
    observedAt: snapshot.observedAt.toISOString(),
    whales: snapshot.whales.map(serializeWhale),
    positions: snapshot.positions.map(serializePosition),
  };
}

function deserializeSnapshot(
  snapshot: SerializedSnapshot,
): WhaleLiveSnapshot {
  return {
    ...snapshot,
    observedAt: new Date(snapshot.observedAt),
    whales: snapshot.whales.map(deserializeWhale),
    positions: snapshot.positions.map(deserializePosition),
  };
}

function uniqueAccounts(whales: WhaleRecord[]): string[] {
  return [...new Set(whales.map((whale) => whale.sourceAccount))];
}

function sourceLabelForWhales(whales: WhaleRecord[]): WhaleLiveSnapshot["source"] {
  const sources = new Set(whales.map((whale) => whale.source));
  if (sources.size === 1) return [...sources][0] ?? "pacifica";
  return "multi";
}

function mergeSnapshot(
  current: WhaleLiveSnapshot | null,
  next: WhaleLiveSnapshot,
): WhaleLiveSnapshot {
  if (current === null || next.source === "multi") return next;

  const source = next.source;
  const refreshedAccounts = new Set(next.accounts);
  const whales = [
    ...current.whales.filter(
      (whale) =>
        whale.source !== source || !refreshedAccounts.has(whale.sourceAccount),
    ),
    ...next.whales,
  ];
  const positions = [
    ...current.positions.filter(
      (position) =>
        position.source !== source ||
        !refreshedAccounts.has(position.sourceAccount),
    ),
    ...next.positions,
  ];

  return {
    source: sourceLabelForWhales(whales),
    observedAt:
      current.observedAt.getTime() > next.observedAt.getTime()
        ? current.observedAt
        : next.observedAt,
    accounts: uniqueAccounts(whales),
    whales,
    positions,
  };
}

export async function writeWhaleLiveSnapshot(
  snapshot: WhaleLiveSnapshot,
  ttlSeconds = WHALE_LIVE_CACHE_TTL_SECONDS,
): Promise<void> {
  const current = await getWhaleLiveSnapshot();
  const merged = mergeSnapshot(current, snapshot);
  await cacheSetJson(WHALE_LIVE_CACHE_KEY, serializeSnapshot(merged), {
    ttlSeconds,
  });
}

export async function getWhaleLiveSnapshot(): Promise<WhaleLiveSnapshot | null> {
  try {
    const snapshot = await cacheGetJson<SerializedSnapshot>(
      WHALE_LIVE_CACHE_KEY,
    );
    return snapshot === null ? null : deserializeSnapshot(snapshot);
  } catch (err) {
    console.warn("[whales] live cache read failed:", err);
    return null;
  }
}

export async function getWhaleLivePositionsForAccount(
  sourceAccount: string,
  source?: WhaleSource,
): Promise<WhalePositionRecord[] | null> {
  const snapshot = await getWhaleLiveSnapshot();
  if (snapshot === null) return null;
  const accountSeen = snapshot.whales.some(
    (whale) =>
      whale.sourceAccount === sourceAccount &&
      (source === undefined || whale.source === source),
  );
  if (!accountSeen) return null;
  return snapshot.positions.filter(
    (position) =>
      position.sourceAccount === sourceAccount &&
      (source === undefined || position.source === source),
  );
}

export async function getWhaleLivePositionById(
  positionId: string,
): Promise<{ whale: WhaleRecord; position: WhalePositionRecord } | null> {
  const snapshot = await getWhaleLiveSnapshot();
  if (snapshot === null) return null;

  const position = snapshot.positions.find((item) => item.id === positionId);
  if (!position) return null;

  const whale = snapshot.whales.find((item) => item.id === position.whaleId);
  if (!whale) return null;

  return { whale, position };
}

export async function clearWhaleLiveSnapshotForTests(): Promise<void> {
  await cacheDelete(WHALE_LIVE_CACHE_KEY);
}
