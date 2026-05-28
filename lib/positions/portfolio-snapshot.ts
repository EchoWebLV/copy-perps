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

export function buildPortfolioSummary(
  payload: PortfolioSnapshotPayload,
): PortfolioSummary {
  const openLegacyPositions = openPositions(payload);
  const closedLegacyPositions = closedPositions(payload);
  const legacyPositionsValueUsd = openLegacyPositions.reduce(
    (sum, position) => sum + (position.currentValueUsdc ?? position.amountUsdc),
    0,
  );
  const copyRowsValueUsd = payload.copyRows.reduce(
    (sum, row) => sum + copyRowValueUsd(row),
    0,
  );
  const nonPacificaCopyRowsValueUsd = payload.copyRows.reduce(
    (sum, row) =>
      (row.venue ?? "pacifica") === "pacifica"
        ? sum
        : sum + copyRowValueUsd(row),
    0,
  );
  const positionsCostUsd =
    openLegacyPositions.reduce((sum, position) => sum + position.amountUsdc, 0) +
    payload.copyRows.reduce(
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
    openCount: openLegacyPositions.length + payload.copyRows.length,
    closedCount: closedLegacyPositions.length,
    netWorthUsd,
  };
}

export function mergePortfolioSnapshotPayload(
  previous: PortfolioSnapshotPayload | null,
  next: PortfolioSnapshotPayload,
  options: { preserveMissingOpenRows?: boolean } = {},
): PortfolioSnapshotPayload {
  if (!previous) return next;

  const mergedRows = mergeCopyRowsForPortfolioRefresh(
    previous.copyRows,
    next.copyRows,
  );

  if (options.preserveMissingOpenRows) {
    const nextKeys = new Set(
      mergedRows.map(
        (row) => row.betId ?? `${row.venue ?? "pacifica"}:${row.market}:${row.side}`,
      ),
    );
    for (const row of previous.copyRows) {
      const key = row.betId ?? `${row.venue ?? "pacifica"}:${row.market}:${row.side}`;
      if (row.liveStatus === "open" && !nextKeys.has(key)) {
        mergedRows.push(row);
      }
    }
  }

  return {
    positions: next.positions,
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
