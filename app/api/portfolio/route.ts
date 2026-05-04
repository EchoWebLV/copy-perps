import { NextResponse } from "next/server";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, users } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { getQuote } from "@/lib/jupiter/swap";
import { USDC_MINT, USDC_DECIMALS } from "@/lib/jupiter/constants";

const STALE_PENDING_MINUTES = 5;

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface Position {
  id: string;
  type: string;
  status: string;
  ticker?: string;
  name?: string;
  tokenAddress?: string;
  tokenAmount?: string;
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
  await db
    .update(bets)
    .set({ status: "abandoned" })
    .where(
      and(
        eq(bets.userId, user.id),
        eq(bets.status, "pending"),
        lt(
          bets.createdAt,
          sql`now() - (${STALE_PENDING_MINUTES} || ' minutes')::interval`,
        ),
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
      const tokenSymbol = meta.tokenSymbol as string | undefined;
      const tokenName = meta.tokenName as string | undefined;
      const tokenAddress = meta.tokenAddress as string | undefined;
      const actualOutAmount = (meta.actualOutAmount ??
        meta.expectedOutAmount) as string | undefined;

      const base: Position = {
        id: bet.id,
        type: bet.type,
        status: bet.status,
        ticker: tokenSymbol,
        name: tokenName,
        tokenAddress,
        tokenAmount: actualOutAmount,
        amountUsdc: bet.amountUsdc,
        openTxHash: bet.txHash,
        closeTxHash: bet.closeTxHash,
        proceedsUsdc: bet.proceedsUsdc ?? null,
        createdAt: bet.createdAt.toISOString(),
        closedAt: bet.closedAt?.toISOString() ?? null,
      };

      if (bet.status === "closed" && bet.proceedsUsdc !== null) {
        const pnl = bet.proceedsUsdc! - bet.amountUsdc;
        return {
          ...base,
          pnlUsdc: pnl,
          pnlPct: (pnl / bet.amountUsdc) * 100,
        };
      }

      if (
        bet.type === "meme" &&
        bet.status === "confirmed" &&
        tokenAddress &&
        actualOutAmount
      ) {
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
          console.warn("[portfolio] sell quote failed for", bet.id, e);
          return { ...base, currentValueUsdc: null };
        }
      }

      return base;
    }),
  );

  return NextResponse.json({ positions });
}
