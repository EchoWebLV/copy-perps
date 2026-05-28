import type { CopyRowData } from "@/components/portfolio/CopyRow";

function finitePositive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function round(value: number): number {
  return Number(value.toFixed(10));
}

export function applyLiveMarksToCopyRows(
  rows: CopyRowData[],
  liveMarks: Record<string, number>,
  options: { pricedAt?: string } = {},
): CopyRowData[] {
  return rows.map((row) => {
    const liveMark = liveMarks[row.market];
    if (
      row.liveStatus !== "open" ||
      !finitePositive(liveMark) ||
      !finitePositive(row.entryPrice) ||
      !finitePositive(row.amountBase)
    ) {
      return row;
    }

    const direction = row.side === "long" ? 1 : -1;
    const pnlUsd = round((liveMark - row.entryPrice) * row.amountBase * direction);
    const notionalUsd = round(liveMark * row.amountBase);
    const unrealizedPnlPct =
      row.stakeUsdc !== null && row.stakeUsdc > 0
        ? round((pnlUsd / row.stakeUsdc) * 100)
        : row.unrealizedPnlPct;

    return {
      ...row,
      markPrice: liveMark,
      pricedAt: options.pricedAt ?? new Date().toISOString(),
      notionalUsd,
      pnlUsd,
      unrealizedPnlPct,
    };
  });
}
