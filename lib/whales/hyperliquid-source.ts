import type { HLAssetPosition, HLFill } from "@/lib/hyperliquid/client";
import { makeWhaleId } from "./identity";
import type { WhalePositionRecord, WhaleSide } from "./types";

export class InvalidHyperliquidPositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidHyperliquidPositionError";
  }
}

function finiteNumber(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new InvalidHyperliquidPositionError(`Invalid Hyperliquid position ${field}`);
  }
  return parsed;
}

function positiveNumber(value: unknown, field: string): number {
  const parsed = finiteNumber(value, field);
  if (parsed <= 0) {
    throw new InvalidHyperliquidPositionError(`Invalid Hyperliquid position ${field}`);
  }
  return parsed;
}

export function hyperliquidSideToWhaleSide(szi: string | number): WhaleSide {
  const size = finiteNumber(szi, "szi");
  if (size === 0) {
    throw new InvalidHyperliquidPositionError("Invalid Hyperliquid position szi");
  }
  return size > 0 ? "long" : "short";
}

export function makeHyperliquidPositionId(args: {
  sourceAccount: string;
  market: string;
  side: WhaleSide;
  entryPrice: number;
}): string {
  const entryKey = Math.round(args.entryPrice * 1_000_000);
  return [
    "hyperliquid",
    args.sourceAccount,
    args.market.toUpperCase(),
    args.side,
    entryKey,
  ].join(":");
}

function sideFromSignedSize(size: number): WhaleSide | null {
  if (size > 0) return "long";
  if (size < 0) return "short";
  return null;
}

function fillEndPosition(fill: HLFill): number | null {
  const start = Number(fill.startPosition);
  const size = Math.abs(Number(fill.sz));
  if (!Number.isFinite(start) || !Number.isFinite(size)) return null;
  if (fill.side === "B") return start + size;
  if (fill.side === "A") return start - size;
  return null;
}

export function deriveHyperliquidPositionOpenTime(args: {
  coin: string;
  side: WhaleSide;
  fills: HLFill[];
}): number | null {
  let openedAtMs: number | null = null;
  const fills = args.fills
    .filter((fill) => fill.coin.toUpperCase() === args.coin.toUpperCase())
    .sort((a, b) => a.time - b.time);

  for (const fill of fills) {
    const start = Number(fill.startPosition);
    const end = fillEndPosition(fill);
    if (!Number.isFinite(start) || end === null || !Number.isFinite(fill.time)) {
      continue;
    }

    const beforeSide = sideFromSignedSize(start);
    const afterSide = sideFromSignedSize(end);
    if (afterSide === args.side && beforeSide !== args.side) {
      openedAtMs = fill.time;
    } else if (beforeSide === args.side && afterSide !== args.side) {
      openedAtMs = null;
    }
  }

  return openedAtMs;
}

function markFromPositionValue(args: {
  positionValue: number;
  amountBase: number;
}): number | null {
  if (args.amountBase <= 0 || args.positionValue <= 0) return null;
  const mark = args.positionValue / args.amountBase;
  return Number.isFinite(mark) && mark > 0 ? mark : null;
}

export function mapHyperliquidPosition(args: {
  sourceAccount: string;
  assetPosition: HLAssetPosition;
  currentMark: number | null;
  now?: Date;
  copyableOnPacifica?: boolean;
  pacificaMaxLeverage?: number | null;
}): WhalePositionRecord {
  const position = args.assetPosition.position;
  const side = hyperliquidSideToWhaleSide(position.szi);
  const signedSize = finiteNumber(position.szi, "szi");
  const amountBase = Math.abs(signedSize);
  if (amountBase <= 0) {
    throw new InvalidHyperliquidPositionError("Invalid Hyperliquid position szi");
  }
  const entryPrice = positiveNumber(position.entryPx, "entryPx");
  const rawNotional = Math.abs(finiteNumber(position.positionValue, "positionValue"));
  const notionalUsd = rawNotional > 0 ? rawNotional : amountBase * entryPrice;
  const leverage = Math.max(1, Math.round(positiveNumber(position.leverage?.value, "leverage")));
  const providedMark =
    args.currentMark !== null && Number.isFinite(args.currentMark) && args.currentMark > 0
      ? args.currentMark
      : null;
  const currentMark =
    providedMark ??
    markFromPositionValue({ positionValue: notionalUsd, amountBase });
  const roe = Number(position.returnOnEquity);
  const directional =
    currentMark === null
      ? null
      : side === "long"
        ? currentMark - entryPrice
        : entryPrice - currentMark;
  const unrealizedPnlPct = Number.isFinite(roe)
    ? roe * 100
    : directional === null
      ? null
      : (directional / entryPrice) * leverage * 100;
  const now = args.now ?? new Date();
  const source = "hyperliquid";
  const whaleId = makeWhaleId(source, args.sourceAccount);

  return {
    id: makeHyperliquidPositionId({
      sourceAccount: args.sourceAccount,
      market: position.coin,
      side,
      entryPrice,
    }),
    whaleId,
    source,
    sourceAccount: args.sourceAccount,
    market: position.coin,
    side,
    leverage,
    amountBase,
    notionalUsd,
    entryPrice,
    currentMark,
    unrealizedPnlPct,
    openedAt: now,
    closedAt: null,
    status: "open",
    raw: {
      ...args.assetPosition,
      sourceKind: "hyperliquid",
      copyableOnPacifica: args.copyableOnPacifica ?? true,
      maxLeverage: args.pacificaMaxLeverage ?? null,
      pacificaMaxLeverage: args.pacificaMaxLeverage ?? null,
    } as unknown as Record<string, unknown>,
    lastSeenAt: now,
  };
}
