function positiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
}

export function clampTailLeverage(value: number, max: number): number {
  const upper = Math.max(1, Math.floor(positiveNumber(max) ?? 1));
  const parsed = Number.isFinite(value) ? value : 1;
  return Math.min(Math.max(Math.round(parsed), 1), upper);
}

export function tailLeverageBounds(args: {
  sourceLeverage: number;
  marketMaxLeverage?: number | null;
}): { initialLeverage: number; maxLeverage: number } {
  const sourceLeverage = Math.max(1, Math.round(args.sourceLeverage));
  const maxLeverage = Math.max(
    1,
    Math.floor(positiveNumber(args.marketMaxLeverage) ?? sourceLeverage),
  );

  return {
    initialLeverage: clampTailLeverage(sourceLeverage, maxLeverage),
    maxLeverage,
  };
}
