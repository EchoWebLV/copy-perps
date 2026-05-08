import { PublicKey } from "@solana/web3.js";
import type { bets } from "@/lib/db/schema";
import { getQuote } from "@/lib/jupiter/swap";
import { USDC_MINT, USDC_DECIMALS } from "@/lib/jupiter/constants";
import { getMarket } from "@/lib/jupiter-prediction/client";
import { readPerpPosition } from "@/lib/flash-trade/perp";

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

// Live mark-to-market for a bet row. For closed bets the PnL is realized
// from `proceedsUsdc`; for confirmed open bets we hit the same pricing
// sources the rest of the app uses (Jupiter swap quote, Jupiter Prediction
// market, Flash Trade on-chain read). Used by /api/portfolio and the
// public /api/leaderboard, where the leaderboard variant just passes the
// owner's pubkey for perp reads.
export async function enrichBet(
  bet: BetRow,
  userPubkey: string | null,
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
    const tokenSymbol = meta.tokenSymbol as string | undefined;
    const tokenName = meta.tokenName as string | undefined;
    const tokenAddress = meta.tokenAddress as string | undefined;
    const actualOutAmount = (meta.actualOutAmount ??
      meta.expectedOutAmount) as string | undefined;

    Object.assign(base, {
      ticker: tokenSymbol,
      name: tokenName,
      tokenAddress,
      tokenAmount: actualOutAmount,
    });

    if (bet.status === "closed" && bet.proceedsUsdc !== null) {
      const pnl = bet.proceedsUsdc! - bet.amountUsdc;
      return {
        ...base,
        pnlUsdc: pnl,
        pnlPct: (pnl / bet.amountUsdc) * 100,
      };
    }

    if (bet.status === "confirmed" && tokenAddress && actualOutAmount) {
      try {
        const quote = await getQuote({
          inputMint: tokenAddress,
          outputMint: USDC_MINT,
          amount: BigInt(actualOutAmount),
          slippageBps: 100,
        });
        const currentValue =
          Number(quote.outAmount) / 10 ** USDC_DECIMALS;
        const pnl = currentValue - bet.amountUsdc;
        return {
          ...base,
          currentValueUsdc: currentValue,
          pnlUsdc: pnl,
          pnlPct: (pnl / bet.amountUsdc) * 100,
        };
      } catch (e) {
        console.warn("[enrichBet] meme sell quote failed for", bet.id, e);
        return { ...base, currentValueUsdc: null };
      }
    }

    return base;
  }

  if (bet.type === "perp") {
    const asset = meta.whaleAsset as string | undefined;
    const flashAsset = meta.flashAsset as string | undefined;
    const side = meta.direction as "long" | "short" | undefined;
    const leverage = meta.whaleLeverage as number | undefined;
    const notionalUsd = meta.notionalUsd as number | undefined;
    const whaleAddress = meta.whaleAddress as string | undefined;

    Object.assign(base, {
      asset,
      ticker: asset,
      side,
      leverage,
      notionalUsd,
      whaleAddress,
    });

    if (bet.status === "closed" && bet.proceedsUsdc !== null) {
      const pnl = bet.proceedsUsdc! - bet.amountUsdc;
      return {
        ...base,
        pnlUsdc: pnl,
        pnlPct: (pnl / bet.amountUsdc) * 100,
      };
    }

    if (
      bet.status === "confirmed" &&
      flashAsset &&
      (side === "long" || side === "short") &&
      userPubkey
    ) {
      try {
        const liveData = await readPerpPosition(
          new PublicKey(userPubkey),
          flashAsset,
          side,
        );
        if (liveData) {
          const currentValue = liveData.positionValueUsd;
          const pnl = currentValue - bet.amountUsdc;
          return {
            ...base,
            currentValueUsdc: currentValue,
            pnlUsdc: pnl,
            pnlPct: (pnl / bet.amountUsdc) * 100,
          };
        }
        return { ...base, currentValueUsdc: null };
      } catch (e) {
        console.warn("[enrichBet] Flash PnL failed for", bet.id, e);
        return { ...base, currentValueUsdc: null };
      }
    }

    return base;
  }

  if (bet.type === "prediction") {
    const question = meta.question as string | undefined;
    const outcome = meta.outcome as "yes" | "no" | undefined;
    const contracts = meta.contracts as string | undefined;
    const marketId = meta.marketId as string | undefined;
    const positionPubkey = meta.positionPubkey as string | undefined;

    Object.assign(base, {
      question,
      outcome,
      contracts,
      marketId,
      positionPubkey,
    });

    if (bet.status === "closed" && bet.proceedsUsdc !== null) {
      const pnl = bet.proceedsUsdc! - bet.amountUsdc;
      return {
        ...base,
        pnlUsdc: pnl,
        pnlPct: (pnl / bet.amountUsdc) * 100,
      };
    }

    if (
      bet.status === "confirmed" &&
      marketId &&
      contracts &&
      (outcome === "yes" || outcome === "no")
    ) {
      try {
        const market = await getMarket(marketId);
        if (!market) return { ...base, currentValueUsdc: null };

        const sellPriceMicroUsd =
          outcome === "yes"
            ? market.pricing.sellYesPriceUsd
            : market.pricing.sellNoPriceUsd;
        const contractsNum = Number(contracts);
        const currentValue = (contractsNum * sellPriceMicroUsd) / 1_000_000;
        const pnl = currentValue - bet.amountUsdc;
        return {
          ...base,
          currentValueUsdc: currentValue,
          pnlUsdc: pnl,
          pnlPct: (pnl / bet.amountUsdc) * 100,
        };
      } catch (e) {
        console.warn(
          "[enrichBet] prediction market quote failed for",
          bet.id,
          e,
        );
        return { ...base, currentValueUsdc: null };
      }
    }

    return base;
  }

  return base;
}
