import type { CopyRowData } from "@/components/portfolio/CopyRow";
import { parseFlashTailMeta } from "@/lib/bets/flash-tail-meta";

// Structural subset of a `bets` row so callers can pass `bets.$inferSelect`
// rows and tests can pass literals.
export interface FlashTailBetRowLike {
  id: string;
  type: string;
  status: string;
  amountUsdc: number;
  proceedsUsdc: number | null;
  meta: unknown;
  createdAt: Date;
  closedAt: Date | null;
}

/**
 * Closed flash-tail bets as portfolio copy rows. Mirrors how closed Pacifica
 * copy bets realize PnL (enrichBet: proceeds minus stake); unknown proceeds
 * stay null instead of reading as a total loss. 'closed-external' rows
 * (position died on-chain without a close postback — liquidation, TP/SL
 * trigger; stamped by the reconcile sweep) render the same way: closed,
 * pnl unknown.
 */
export function closedFlashTailCopyRows(
  rows: FlashTailBetRowLike[],
): CopyRowData[] {
  const out: CopyRowData[] = [];
  for (const bet of rows) {
    if (bet.type !== "flash-tail") continue;
    if (bet.status !== "closed" && bet.status !== "closed-external") continue;
    const meta = parseFlashTailMeta(bet.meta);
    if (!meta) continue;

    const pnlUsd =
      bet.proceedsUsdc == null ? null : bet.proceedsUsdc - bet.amountUsdc;
    const pnlPct =
      pnlUsd != null && bet.amountUsdc > 0
        ? (pnlUsd / bet.amountUsdc) * 100
        : null;
    const closedAtIso = bet.closedAt?.toISOString() ?? null;

    out.push({
      betId: bet.id,
      venue: "flash",
      sourceKind: "tail",
      market: meta.market,
      side: meta.side,
      leverage: meta.leverage,
      stakeUsdc: bet.amountUsdc,
      openFeeUsd: meta.openFeeUsd,
      leaderAddress: null,
      leaderUsername: null,
      whaleId: meta.whaleId,
      whaleName: meta.sourceKind === "whale" ? meta.sourceName : null,
      autoCloseOnSourceClose: false,
      closeReason: meta.closeReason,
      botId: meta.botId,
      botName:
        meta.sourceKind === "bot" || meta.sourceKind === "autopilot"
          ? meta.sourceName
          : null,
      liveStatus: "closed",
      entryPrice: meta.entryPriceUsd,
      markPrice: null,
      pricedAt: null,
      liquidationPrice: null,
      amountBase: null,
      marginUsd: null,
      marginMode: null,
      notionalUsd: meta.notionalUsd,
      pnlUsd,
      unrealizedPnlPct: pnlPct,
      openedAt: bet.createdAt.toISOString(),
      positionUpdatedAt: closedAtIso,
      closedAt: closedAtIso,
      leaderClosedAt: null,
    });
  }
  return out;
}
