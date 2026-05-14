export interface PaperPnlArgs {
  side: "long" | "short";
  leverage: number;
  entryMark: number;
  exitMark: number;
  notionalUsd: number;
}

/**
 * Realized paper PnL in USD at exit. notionalUsd is the position size in
 * USD (== stake × leverage). Sign convention: positive = profit.
 */
export function computePaperPnlUsd(args: PaperPnlArgs): number {
  const { side, entryMark, exitMark, notionalUsd } = args;
  const moveFrac = (exitMark - entryMark) / entryMark;
  const directional = side === "long" ? moveFrac : -moveFrac;
  return notionalUsd * directional;
}

export interface LivePaperPnlArgs {
  side: "long" | "short";
  leverage: number;
  entryMark: number;
  currentMark: number;
}

/**
 * Unrealized paper PnL as a fraction of stake (not notional). At leverage L
 * and price move M%, this returns L*M (e.g. 5x with +10% move = +50%).
 */
export function computeLivePaperPnlPct(args: LivePaperPnlArgs): number {
  const { side, leverage, entryMark, currentMark } = args;
  const moveFrac = (currentMark - entryMark) / entryMark;
  const directional = side === "long" ? moveFrac : -moveFrac;
  return directional * leverage;
}
