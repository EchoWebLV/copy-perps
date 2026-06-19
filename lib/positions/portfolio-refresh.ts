export type PortfolioCopyRowStatus = "open" | "not_found" | "unknown" | "closed";

export interface PortfolioCopyRowRefreshShape {
  betId: string | null;
  venue?: "pacifica" | "flash" | "flash-v2";
  market: string;
  side: "long" | "short";
  liveStatus: PortfolioCopyRowStatus;
  markPrice: number | null;
  notionalUsd: number | null;
  pnlUsd: number | null;
  unrealizedPnlPct: number | null;
  pricedAt: string | null;
  entryPrice?: number | null;
  liquidationPrice?: number | null;
  amountBase?: number | null;
  marginUsd?: number | null;
  marginMode?: "cross" | "isolated" | null;
  openedAt?: string | null;
  positionUpdatedAt?: string | null;
}

function rowKey(row: PortfolioCopyRowRefreshShape) {
  return row.betId ?? `${row.venue ?? "pacifica"}:${row.market}:${row.side}`;
}

function hasFreshLiveValues(row: PortfolioCopyRowRefreshShape) {
  return (
    row.markPrice !== null ||
    row.notionalUsd !== null ||
    row.pnlUsd !== null ||
    row.pricedAt !== null
  );
}

export function mergeCopyRowsForPortfolioRefresh<
  T extends PortfolioCopyRowRefreshShape,
>(current: T[], next: T[]): T[] {
  const currentByKey = new Map(current.map((row) => [rowKey(row), row]));

  return next.map((row) => {
    const previous = currentByKey.get(rowKey(row));
    if (!previous) return row;
    if (row.liveStatus !== "unknown") return row;
    if (previous.liveStatus !== "open") return row;
    if (hasFreshLiveValues(row)) return row;

    return {
      ...row,
      liveStatus: previous.liveStatus,
      markPrice: previous.markPrice,
      notionalUsd: previous.notionalUsd,
      pnlUsd: previous.pnlUsd,
      unrealizedPnlPct: previous.unrealizedPnlPct,
      pricedAt: previous.pricedAt,
      entryPrice: previous.entryPrice,
      liquidationPrice: previous.liquidationPrice,
      amountBase: previous.amountBase,
      marginUsd: previous.marginUsd,
      marginMode: previous.marginMode,
      openedAt: previous.openedAt,
      positionUpdatedAt: previous.positionUpdatedAt,
    };
  });
}
