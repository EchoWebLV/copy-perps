import type { CopyRowData } from "@/components/portfolio/CopyRow";
import type { EnrichedPosition } from "@/lib/positions/enrich";
import { mergeCopyRowsForPortfolioRefresh } from "@/lib/positions/portfolio-refresh";

export interface PortfolioWalletBalance {
  stableUsd: number | null;
  sol: number | null;
  updatedAt: string | null;
}

export interface PortfolioSnapshotPayload {
  positions: EnrichedPosition[];
  copyRows: CopyRowData[];
  pacificaAccount: {
    balanceUsd: number | null;
    equityUsd: number | null;
    availableToSpendUsd: number | null;
    availableToWithdrawUsd: number | null;
    totalMarginUsedUsd: number | null;
    pendingDepositUsd?: number;
    pendingDeposits?: Array<{
      amountUsdc: number;
      signature: string;
      createdAt: string;
    }>;
    updatedAt: string | null;
  } | null;
  walletBalance: PortfolioWalletBalance | null;
}

export interface PortfolioSummary {
  walletStableUsd: number | null;
  walletSol: number | null;
  pacificaEquityUsd: number | null;
  pacificaAvailableUsd: number | null;
  availableCashUsd: number | null;
  processingFundsUsd: number;
  legacyPositionsValueUsd: number;
  copyRowsValueUsd: number;
  positionsValueUsd: number;
  positionsCostUsd: number;
  positionsPnlUsd: number;
  positionsPnlPct: number;
  openCount: number;
  closedCount: number;
  netWorthUsd: number | null;
}

export type PortfolioSnapshotStatus = "empty" | "live" | "stale" | "delayed";

export interface PortfolioSnapshotMeta {
  source: "cache" | "fallback" | "live";
  status: PortfolioSnapshotStatus;
  updatedAt: string | null;
  staleReason: string | null;
}

function copyRowKey(row: CopyRowData): string {
  return row.betId ?? `${row.venue ?? "pacifica"}:${row.market}:${row.side}`;
}

function openPositions(payload: PortfolioSnapshotPayload) {
  return payload.positions.filter(
    (position) =>
      position.type !== "copy" &&
      ["pending", "confirmed"].includes(position.status),
  );
}

function closedPositions(payload: PortfolioSnapshotPayload) {
  return payload.positions.filter((position) => position.status === "closed");
}

function copyRowValueUsd(row: CopyRowData): number {
  if (row.stakeUsdc === null) {
    const marginValue =
      row.marginUsd === null ? 0 : row.marginUsd + (row.pnlUsd ?? 0);
    return Math.max(0, marginValue);
  }
  const liveMultiplier =
    row.unrealizedPnlPct === null ? 1 : 1 + row.unrealizedPnlPct / 100;
  return Math.max(0, row.stakeUsdc * liveMultiplier);
}

function flashClosedPositionId(row: CopyRowData): string {
  return `flash:${row.market}:${row.side}:${
    row.openedAt ?? row.positionUpdatedAt ?? row.pricedAt ?? "unknown"
  }`;
}

function isSnapshotFlashClosedPosition(position: EnrichedPosition): boolean {
  return position.status === "closed" && position.id.startsWith("flash:");
}

function isOpenFlashWalletRow(row: CopyRowData): boolean {
  return (
    row.venue === "flash" &&
    row.sourceKind === "wallet" &&
    row.liveStatus === "open"
  );
}

function flashClosedPositionFromRow(
  row: CopyRowData,
  closedAt: string,
): EnrichedPosition {
  const amountUsdc = row.stakeUsdc ?? row.marginUsd ?? 0;
  const proceedsUsdc =
    amountUsdc > 0 && row.pnlUsd !== null
      ? Math.max(0, amountUsdc + row.pnlUsd)
      : null;
  return {
    id: flashClosedPositionId(row),
    type: "copy",
    status: "closed",
    amountUsdc,
    proceedsUsdc,
    pnlUsdc: proceedsUsdc === null ? undefined : proceedsUsdc - amountUsdc,
    pnlPct:
      proceedsUsdc === null || amountUsdc <= 0
        ? undefined
        : ((proceedsUsdc - amountUsdc) / amountUsdc) * 100,
    asset: row.market,
    ticker: row.market,
    side: row.side,
    leverage: row.leverage ?? undefined,
    notionalUsd: row.notionalUsd ?? undefined,
    openTxHash: null,
    closeTxHash: null,
    createdAt: row.openedAt ?? row.positionUpdatedAt ?? row.pricedAt ?? closedAt,
    closedAt,
    sharedAt: null,
  };
}

export function buildPortfolioSummary(
  payload: PortfolioSnapshotPayload,
): PortfolioSummary {
  const openLegacyPositions = openPositions(payload);
  const closedLegacyPositions = closedPositions(payload);
  // Closed copy rows are settled history — their proceeds already sit in a
  // wallet balance, so they carry no open value, cost, or count.
  const openCopyRows = payload.copyRows.filter(
    (row) => row.liveStatus !== "closed",
  );
  const closedCopyRows = payload.copyRows.filter(
    (row) => row.liveStatus === "closed",
  );
  const legacyPositionsValueUsd = openLegacyPositions.reduce(
    (sum, position) => sum + (position.currentValueUsdc ?? position.amountUsdc),
    0,
  );
  const copyRowsValueUsd = openCopyRows.reduce(
    (sum, row) => sum + copyRowValueUsd(row),
    0,
  );
  const nonPacificaCopyRowsValueUsd = openCopyRows.reduce(
    (sum, row) =>
      (row.venue ?? "pacifica") === "pacifica"
        ? sum
        : sum + copyRowValueUsd(row),
    0,
  );
  const positionsCostUsd =
    openLegacyPositions.reduce((sum, position) => sum + position.amountUsdc, 0) +
    openCopyRows.reduce(
      (sum, row) => sum + (row.stakeUsdc ?? row.marginUsd ?? 0),
      0,
    );
  const positionsValueUsd = legacyPositionsValueUsd + copyRowsValueUsd;
  const positionsPnlUsd = positionsValueUsd - positionsCostUsd;
  const positionsPnlPct =
    positionsCostUsd > 0 ? (positionsPnlUsd / positionsCostUsd) * 100 : 0;
  const walletStableUsd = payload.walletBalance?.stableUsd ?? null;
  const walletSol = payload.walletBalance?.sol ?? null;
  const pacificaEquityUsd = payload.pacificaAccount?.equityUsd ?? null;
  const pacificaAvailableUsd =
    payload.pacificaAccount?.availableToSpendUsd ?? null;
  const processingFundsUsd = Math.max(
    0,
    payload.pacificaAccount?.pendingDepositUsd ?? 0,
  );
  const pacificaPortfolioValue =
    pacificaEquityUsd == null
      ? copyRowsValueUsd
      : pacificaEquityUsd + nonPacificaCopyRowsValueUsd;
  const availableCashUsd =
    walletStableUsd == null && pacificaAvailableUsd == null
      ? null
      : (walletStableUsd ?? 0) + (pacificaAvailableUsd ?? 0);
  const netWorthUsd =
    walletStableUsd == null && pacificaEquityUsd == null && positionsValueUsd === 0
      ? null
      : (walletStableUsd ?? 0) +
        pacificaPortfolioValue +
        legacyPositionsValueUsd +
        processingFundsUsd;

  return {
    walletStableUsd,
    walletSol,
    pacificaEquityUsd,
    pacificaAvailableUsd,
    availableCashUsd,
    processingFundsUsd,
    legacyPositionsValueUsd,
    copyRowsValueUsd,
    positionsValueUsd,
    positionsCostUsd,
    positionsPnlUsd,
    positionsPnlPct,
    openCount: openLegacyPositions.length + openCopyRows.length,
    closedCount: closedLegacyPositions.length + closedCopyRows.length,
    netWorthUsd,
  };
}

export function mergePortfolioSnapshotPayload(
  previous: PortfolioSnapshotPayload | null,
  next: PortfolioSnapshotPayload,
  options: { preserveMissingOpenRows?: boolean; now?: () => Date } = {},
): PortfolioSnapshotPayload {
  if (!previous) return next;

  const mergedRows = mergeCopyRowsForPortfolioRefresh(
    previous.copyRows,
    next.copyRows,
  );
  const mergedRowKeys = new Set(mergedRows.map(copyRowKey));
  const closedAt = (options.now?.() ?? new Date()).toISOString();
  const mergedPositions: EnrichedPosition[] = [...next.positions];
  const mergedPositionIds = new Set(mergedPositions.map((position) => position.id));

  for (const position of previous.positions) {
    if (
      isSnapshotFlashClosedPosition(position) &&
      !mergedPositionIds.has(position.id)
    ) {
      mergedPositions.push(position);
      mergedPositionIds.add(position.id);
    }
  }

  if (!options.preserveMissingOpenRows) {
    for (const row of previous.copyRows) {
      if (!isOpenFlashWalletRow(row) || mergedRowKeys.has(copyRowKey(row))) {
        continue;
      }
      const position = flashClosedPositionFromRow(row, closedAt);
      if (mergedPositionIds.has(position.id)) continue;
      mergedPositions.push(position);
      mergedPositionIds.add(position.id);
    }
  }

  if (options.preserveMissingOpenRows) {
    for (const row of previous.copyRows) {
      if (row.liveStatus === "open" && !mergedRowKeys.has(copyRowKey(row))) {
        mergedRows.push(row);
      }
    }
  }

  return {
    positions: mergedPositions,
    copyRows: mergedRows,
    pacificaAccount: next.pacificaAccount,
    walletBalance: next.walletBalance,
  };
}

export function emptyPortfolioPayload(): PortfolioSnapshotPayload {
  return {
    positions: [],
    copyRows: [],
    pacificaAccount: null,
    walletBalance: null,
  };
}
