import type { PacificaPosition } from "@/lib/pacifica/types";
import { makeWhaleId, makeWhalePositionId } from "./identity";
import type { WhalePositionRecord, WhaleSide } from "./types";

export class InvalidPacificaPositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPacificaPositionError";
  }
}

export function pacificaSideToWhaleSide(
  side: PacificaPosition["side"],
): WhaleSide {
  return side === "bid" ? "long" : "short";
}

export function leverageFromPacificaPosition(args: {
  amountBase: number;
  entryPrice: number;
  marginUsd: number;
  marketMaxLeverage: number;
}): number {
  if (args.marginUsd <= 0) return Math.max(1, Math.floor(args.marketMaxLeverage));
  const notional = Math.abs(args.amountBase * args.entryPrice);
  const raw = notional / args.marginUsd;
  return Math.max(1, Math.min(args.marketMaxLeverage, Math.round(raw)));
}

function requireFiniteNumber(
  value: number,
  field: string,
): number {
  if (!Number.isFinite(value)) {
    throw new InvalidPacificaPositionError(`Invalid Pacifica position ${field}`);
  }
  return value;
}

function requirePositiveNumber(
  value: number,
  field: string,
): number {
  const parsed = requireFiniteNumber(value, field);
  if (parsed <= 0) {
    throw new InvalidPacificaPositionError(`Invalid Pacifica position ${field}`);
  }
  return parsed;
}

function requireNonNegativeNumber(
  value: number,
  field: string,
): number {
  const parsed = requireFiniteNumber(value, field);
  if (parsed < 0) {
    throw new InvalidPacificaPositionError(`Invalid Pacifica position ${field}`);
  }
  return parsed;
}

function requireValidTimestamp(value: number, field: string): number {
  const parsed = requireFiniteNumber(value, field);
  if (Number.isNaN(new Date(parsed).getTime())) {
    throw new InvalidPacificaPositionError(`Invalid Pacifica position ${field}`);
  }
  return parsed;
}

export function mapPacificaPosition(args: {
  sourceAccount: string;
  position: PacificaPosition;
  marketMaxLeverage: number;
  currentMark: number | null;
  now?: Date;
}): WhalePositionRecord {
  const side = pacificaSideToWhaleSide(args.position.side);
  const amountBase = requirePositiveNumber(Number(args.position.amount), "amount");
  const entryPrice = requirePositiveNumber(
    Number(args.position.entry_price),
    "entry_price",
  );
  const marginUsd = requireNonNegativeNumber(
    Number(args.position.margin),
    "margin",
  );
  const marketMaxLeverage = requireFiniteNumber(
    args.marketMaxLeverage,
    "marketMaxLeverage",
  );
  if (marketMaxLeverage < 1) {
    throw new InvalidPacificaPositionError(
      "Invalid Pacifica position marketMaxLeverage",
    );
  }
  const notionalUsd = amountBase * entryPrice;
  const leverage = leverageFromPacificaPosition({
    amountBase,
    entryPrice,
    marginUsd,
    marketMaxLeverage,
  });
  const mark =
    args.currentMark == null
      ? null
      : requirePositiveNumber(args.currentMark, "currentMark");
  const directional =
    mark == null ? null : side === "long" ? mark - entryPrice : entryPrice - mark;
  const unrealizedPnlPct =
    directional == null || notionalUsd <= 0
      ? null
      : (directional / entryPrice) * leverage * 100;
  const openedAtMs = requireValidTimestamp(
    Number(args.position.created_at),
    "created_at",
  );
  const source = "pacifica";
  const whaleId = makeWhaleId(source, args.sourceAccount);

  return {
    id: makeWhalePositionId({
      source,
      sourceAccount: args.sourceAccount,
      market: args.position.symbol,
      side,
      openedAtMs,
    }),
    whaleId,
    source,
    sourceAccount: args.sourceAccount,
    market: args.position.symbol,
    side,
    leverage,
    amountBase,
    notionalUsd,
    entryPrice,
    currentMark: mark,
    unrealizedPnlPct,
    openedAt: new Date(openedAtMs),
    closedAt: null,
    status: "open",
    raw: args.position as unknown as Record<string, unknown>,
    lastSeenAt: args.now ?? new Date(),
  };
}
