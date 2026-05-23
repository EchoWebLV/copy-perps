import {
  cacheDelete,
  cacheGetJson,
  cacheSetJson,
} from "@/lib/cache/redis";
import { WHALE_SOURCE_MAX_AGE_MS } from "./identity";
import type { WhalePositionRecord, WhaleRecord } from "./types";

export const WHALE_LIVE_CACHE_KEY = "copy-perps:whales:pacifica:live:v1";
export const WHALE_LIVE_CACHE_TTL_SECONDS =
  Math.ceil(WHALE_SOURCE_MAX_AGE_MS / 1000) + 15;

export interface WhaleLiveSnapshot {
  source: "pacifica";
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

export async function writeWhaleLiveSnapshot(
  snapshot: WhaleLiveSnapshot,
  ttlSeconds = WHALE_LIVE_CACHE_TTL_SECONDS,
): Promise<void> {
  await cacheSetJson(WHALE_LIVE_CACHE_KEY, serializeSnapshot(snapshot), {
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
): Promise<WhalePositionRecord[] | null> {
  const snapshot = await getWhaleLiveSnapshot();
  if (snapshot === null) return null;
  if (!snapshot.accounts.includes(sourceAccount)) return null;
  return snapshot.positions.filter(
    (position) => position.sourceAccount === sourceAccount,
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
