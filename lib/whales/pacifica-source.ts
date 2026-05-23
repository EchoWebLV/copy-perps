import type { PacificaPosition } from "@/lib/pacifica/types";
import { makeWhaleId, makeWhalePositionId } from "./identity";
import type { WhalePositionRecord, WhaleSide } from "./types";

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

export function mapPacificaPosition(args: {
  sourceAccount: string;
  position: PacificaPosition;
  marketMaxLeverage: number;
  currentMark: number | null;
  now?: Date;
}): WhalePositionRecord {
  const side = pacificaSideToWhaleSide(args.position.side);
  const amountBase = Math.abs(Number(args.position.amount));
  const entryPrice = Number(args.position.entry_price);
  const marginUsd = Number(args.position.margin);
  const notionalUsd = amountBase * entryPrice;
  const leverage = leverageFromPacificaPosition({
    amountBase,
    entryPrice,
    marginUsd,
    marketMaxLeverage: args.marketMaxLeverage,
  });
  const mark = args.currentMark;
  const directional =
    mark == null ? null : side === "long" ? mark - entryPrice : entryPrice - mark;
  const unrealizedPnlPct =
    directional == null || notionalUsd <= 0
      ? null
      : (directional / entryPrice) * leverage * 100;
  const openedAtMs = Number(args.position.created_at);
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
