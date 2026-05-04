import { NextResponse } from "next/server";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { PublicKey } from "@solana/web3.js";
import { db } from "@/lib/db";
import { bets, users } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { getQuote } from "@/lib/jupiter/swap";
import { USDC_MINT, USDC_DECIMALS } from "@/lib/jupiter/constants";
import { getMarket } from "@/lib/jupiter-prediction/client";
import { readPerpPosition } from "@/lib/flash-trade/perp";

const STALE_PENDING_MS = 5 * 60 * 1000;

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface Position {
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
}

export async function GET(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.privyId, claims.userId))
    .limit(1);
  if (!user) return NextResponse.json({ positions: [] });

  // Reap pending bets that never reached the confirm step (sign cancelled,
  // wallet modal closed, network died mid-sign, etc.) so they don't clutter
  // the portfolio forever.
  const staleCutoff = new Date(Date.now() - STALE_PENDING_MS);
  await db
    .update(bets)
    .set({ status: "abandoned" })
    .where(
      and(
        eq(bets.userId, user.id),
        eq(bets.status, "pending"),
        lt(bets.createdAt, staleCutoff),
      ),
    );

  const userBets = await db
    .select()
    .from(bets)
    .where(
      and(
        eq(bets.userId, user.id),
        inArray(bets.status, ["pending", "confirmed", "closed"]),
      ),
    )
    .orderBy(desc(bets.createdAt));

  const positions = await Promise.all(
    userBets.map(async (bet): Promise<Position> => {
      const meta = (bet.meta ?? {}) as Record<string, unknown>;

      const base: Position = {
        id: bet.id,
        type: bet.type,
        status: bet.status,
        amountUsdc: bet.amountUsdc,
        openTxHash: bet.txHash,
        closeTxHash: bet.closeTxHash,
        proceedsUsdc: bet.proceedsUsdc ?? null,
        createdAt: bet.createdAt.toISOString(),
        closedAt: bet.closedAt?.toISOString() ?? null,
      };

      // ---- Meme bet ----
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
            console.warn("[portfolio] meme sell quote failed for", bet.id, e);
            return { ...base, currentValueUsdc: null };
          }
        }

        return base;
      }

      // ---- Perp bet (Flash Trade) ----
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
          user.solanaPubkey
        ) {
          try {
            const liveData = await readPerpPosition(
              new PublicKey(user.solanaPubkey),
              flashAsset,
              side,
            );
            if (liveData) {
              // positionValueUsd = on-chain collateral + unrealized
              // mark-to-market PnL. Comparing against the bet's original
              // amountUsdc captures entry fees too, so the displayed PnL
              // matches what the user would actually receive on close.
              const currentValue = liveData.positionValueUsd;
              const pnl = currentValue - bet.amountUsdc;
              return {
                ...base,
                currentValueUsdc: currentValue,
                pnlUsdc: pnl,
                pnlPct: (pnl / bet.amountUsdc) * 100,
              };
            }
            // No live exposure (position closed externally, or
            // Flash readPerpPosition is still stubbed).
            return { ...base, currentValueUsdc: null };
          } catch (e) {
            console.warn("[portfolio] Flash PnL failed for", bet.id, e);
            return { ...base, currentValueUsdc: null };
          }
        }

        return base;
      }

      // ---- Prediction bet ----
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
            // contracts × sell price (micro-USD per contract) → divide by 1e6
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
              "[portfolio] prediction market quote failed for",
              bet.id,
              e,
            );
            return { ...base, currentValueUsdc: null };
          }
        }

        return base;
      }

      return base;
    }),
  );

  return NextResponse.json({ positions });
}
