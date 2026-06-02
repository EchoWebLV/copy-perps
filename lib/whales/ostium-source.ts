import { ostiumPairToFlashSymbol } from "./ostium-markets";
import { makeWhaleId } from "./identity";
import type { WhalePositionRecord, WhaleSide } from "./types";

const PRICE_SCALE = 1e18; // openPrice, lastTradePrice
const USD_SCALE = 1e6; // collateral, notional (USDC 6dp)

export class InvalidOstiumTradeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOstiumTradeError";
  }
}

export interface OstiumRawTrade {
  tradeID: string;
  trader: string;
  collateral: string;
  leverage: string;
  notional: string;
  openPrice: string;
  isBuy: boolean;
  isOpen: boolean;
  timestamp: string;
  index: string;
  pair: {
    id: string;
    from: string;
    to: string;
    lastTradePrice: string | null;
  };
}

export function ostiumDisplayName(account: string): string {
  if (account.length <= 10) return `OST ${account}`;
  return `OST ${account.slice(0, 6)}…${account.slice(-4)}`;
}

function finitePositive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidOstiumTradeError(`Invalid Ostium trade ${field}`);
  }
  return value;
}

export function mapOstiumTrade(args: {
  trade: OstiumRawTrade;
  now?: Date;
}): WhalePositionRecord {
  const { trade } = args;
  const market = ostiumPairToFlashSymbol(trade.pair.id);
  if (market === null) {
    throw new InvalidOstiumTradeError(`Unmapped Ostium pair ${trade.pair.id}`);
  }

  const sourceAccount = trade.trader.toLowerCase();
  const side: WhaleSide = trade.isBuy ? "long" : "short";
  const entryPrice = finitePositive(
    Number(trade.openPrice) / PRICE_SCALE,
    "openPrice",
  );
  const notionalUsd = finitePositive(
    Number(trade.notional) / USD_SCALE,
    "notional",
  );
  const collateralUsd = Number(trade.collateral) / USD_SCALE;
  const leverageRaw =
    Number.isFinite(collateralUsd) && collateralUsd > 0
      ? notionalUsd / collateralUsd
      : Number(trade.leverage) / 100;
  const leverage = Math.max(1, Math.round(leverageRaw));
  const amountBase = notionalUsd / entryPrice;

  const markRaw = Number(trade.pair.lastTradePrice) / PRICE_SCALE;
  const currentMark = Number.isFinite(markRaw) && markRaw > 0 ? markRaw : null;
  const directional =
    currentMark === null
      ? null
      : side === "long"
        ? currentMark - entryPrice
        : entryPrice - currentMark;
  const unrealizedPnlPct =
    directional === null
      ? null
      : (directional / entryPrice) * leverageRaw * 100;

  const openedAtMs = Number(trade.timestamp) * 1000;
  if (!Number.isFinite(openedAtMs) || openedAtMs <= 0) {
    throw new InvalidOstiumTradeError("Invalid Ostium trade timestamp");
  }
  const now = args.now ?? new Date();

  return {
    id: `ostium:${sourceAccount}:${market}:${side}:${trade.tradeID}`,
    whaleId: makeWhaleId("ostium", sourceAccount),
    source: "ostium",
    sourceAccount,
    market,
    side,
    leverage,
    amountBase,
    notionalUsd,
    entryPrice,
    currentMark,
    unrealizedPnlPct,
    openedAt: new Date(openedAtMs),
    closedAt: null,
    status: "open",
    raw: {
      ...trade,
      flashSymbol: market,
      ostiumPairId: trade.pair.id,
    } as unknown as Record<string, unknown>,
    lastSeenAt: now,
  };
}
