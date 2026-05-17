import type { bets } from "@/lib/db/schema";

type BetRow = typeof bets.$inferSelect;

export interface EnrichedPosition {
  id: string;
  type: string;
  status: string;
  // meme fields
  ticker?: string;
  name?: string;
  tokenAddress?: string;
  tokenAmount?: string;
  // prediction fields
  question?: string;
  outcome?: "yes" | "no";
  contracts?: string;
  marketId?: string;
  positionPubkey?: string;
  // perp fields
  asset?: string;
  side?: "long" | "short";
  leverage?: number;
  notionalUsd?: number;
  whaleAddress?: string;
  // shared
  amountUsdc: number;
  currentValueUsdc?: number | null;
  proceedsUsdc?: number | null;
  pnlUsdc?: number | null;
  pnlPct?: number | null;
  openTxHash?: string | null;
  closeTxHash?: string | null;
  createdAt: string;
  closedAt?: string | null;
  sharedAt?: string | null;
}

// Mark-to-market for a `bets` row. Closed bets realize PnL straight from
// proceedsUsdc. Open rows surface their stored fields; live valuation of
// the retired meme/prediction/perp rails (Jupiter swap quote, Jupiter
// Prediction market, Flash on-chain read) was removed with those rails,
// so open legacy bets carry no live currentValue. `_userPubkey` is kept
// in the signature for the callers (/api/portfolio, /api/leaderboard).
export async function enrichBet(
  bet: BetRow,
  _userPubkey: string | null,
): Promise<EnrichedPosition> {
  const meta = (bet.meta ?? {}) as Record<string, unknown>;

  const base: EnrichedPosition = {
    id: bet.id,
    type: bet.type,
    status: bet.status,
    amountUsdc: bet.amountUsdc,
    openTxHash: bet.txHash,
    closeTxHash: bet.closeTxHash,
    proceedsUsdc: bet.proceedsUsdc ?? null,
    createdAt: bet.createdAt.toISOString(),
    closedAt: bet.closedAt?.toISOString() ?? null,
    sharedAt: bet.sharedAt?.toISOString() ?? null,
  };

  if (bet.type === "meme") {
    base.ticker = meta.tokenSymbol as string | undefined;
    base.name = meta.tokenName as string | undefined;
    base.tokenAddress = meta.tokenAddress as string | undefined;
    base.tokenAmount = (meta.actualOutAmount ?? meta.expectedOutAmount) as
      | string
      | undefined;
  } else if (bet.type === "perp") {
    const asset = meta.whaleAsset as string | undefined;
    base.asset = asset;
    base.ticker = asset;
    base.side = meta.direction as "long" | "short" | undefined;
    base.leverage = meta.whaleLeverage as number | undefined;
    base.notionalUsd = meta.notionalUsd as number | undefined;
    base.whaleAddress = meta.whaleAddress as string | undefined;
  } else if (bet.type === "prediction") {
    base.question = meta.question as string | undefined;
    base.outcome = meta.outcome as "yes" | "no" | undefined;
    base.contracts = meta.contracts as string | undefined;
    base.marketId = meta.marketId as string | undefined;
    base.positionPubkey = meta.positionPubkey as string | undefined;
  }

  if (bet.status === "closed" && bet.proceedsUsdc !== null) {
    const pnl = bet.proceedsUsdc! - bet.amountUsdc;
    base.pnlUsdc = pnl;
    base.pnlPct = (pnl / bet.amountUsdc) * 100;
  }

  return base;
}
