import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { hasOpenTailOnMarket } from "@/lib/bets/copy-guard";
import {
  PacificaDepositPendingError,
  PacificaDepositSettlingError,
  PacificaFundingRateLimitError,
  isPacificaFundingRateLimitError,
  planPacificaDepositTopUp,
} from "@/lib/bets/funding";
import {
  blockTailReservation,
  releaseTailReservation,
  reserveTailOnMarket,
} from "@/lib/bets/tail-reservation";
import { buildWhaleCopyMeta } from "@/lib/bets/whale-meta";
import { planOnboarding } from "@/lib/bets/onboard";
import { getMark } from "@/lib/data/marks";
import { db } from "@/lib/db";
import { bets } from "@/lib/db/schema";
import { whaleSocialEnabled } from "@/lib/features";
import { InsufficientWalletUsdcError } from "@/lib/pacifica/deposit";
import { clampLeverageForNotional, getMarketBySymbol } from "@/lib/pacifica/markets";
import { closeCopyOrder, openCopyOrder } from "@/lib/pacifica/orders";
import { lotSizedAmountFromNotional } from "@/lib/pacifica/sizing";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { getAgentWallet } from "@/lib/wallets/agent";
import { isSourceFresh } from "@/lib/whales/identity";
import { getWhaleLivePositionById } from "@/lib/whales/live-cache";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MIN_USDC = 5;
const MAX_USDC = 1000;

interface Body {
  positionId?: string;
  stakeUsdc?: number;
  walletAddress?: string;
  leverage?: number;
  autoCloseOnSourceClose?: boolean;
}

function fundingErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof InsufficientWalletUsdcError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof PacificaDepositPendingError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof PacificaDepositSettlingError) {
    return NextResponse.json(
      { error: err.message, retryable: true, retryAfterMs: err.retryAfterMs },
      { status: 409 },
    );
  }
  if (isPacificaFundingRateLimitError(err)) {
    return NextResponse.json(
      {
        error: "Pacifica is rate limiting balance checks. Retrying shortly.",
        retryable: true,
        retryAfterMs:
          err instanceof PacificaFundingRateLimitError ? err.retryAfterMs : 5000,
      },
      { status: 409 },
    );
  }
  return null;
}

async function releaseReservationBestEffort(userId: string, market: string) {
  try {
    await releaseTailReservation(userId, market);
  } catch (err) {
    console.warn("[bet/whale] reservation cleanup failed:", err);
  }
}

async function markBetFailedBestEffort(betId: string) {
  try {
    await db.update(bets).set({ status: "failed" }).where(eq(bets.id, betId));
  } catch (err) {
    console.warn("[bet/whale] failed bet update failed:", err);
  }
}

async function markBetManualReviewBestEffort(betId: string) {
  try {
    await db
      .update(bets)
      .set({ status: "manual_review" })
      .where(eq(bets.id, betId));
  } catch (err) {
    console.warn("[bet/whale] manual review bet update failed:", err);
  }
}

async function blockReservationBestEffort(userId: string, market: string) {
  try {
    await blockTailReservation(userId, market);
  } catch (err) {
    console.warn("[bet/whale] reservation block failed:", err);
  }
}

async function resolveSizingPrice(position: {
  currentMark: number | null;
  market: string;
}) {
  if (typeof position.currentMark === "number" && position.currentMark > 0) {
    return position.currentMark;
  }
  const mark = await getMark(position.market);
  return typeof mark === "number" && mark > 0 ? mark : null;
}

export async function POST(request: Request) {
  if (!whaleSocialEnabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (
    !body?.positionId ||
    typeof body.stakeUsdc !== "number" ||
    !body.walletAddress ||
    typeof body.autoCloseOnSourceClose !== "boolean"
  ) {
    return NextResponse.json(
      {
        error:
          "positionId, stakeUsdc, walletAddress, autoCloseOnSourceClose required",
      },
      { status: 400 },
    );
  }
  if (body.stakeUsdc < MIN_USDC || body.stakeUsdc > MAX_USDC) {
    return NextResponse.json(
      { error: `stake must be between $${MIN_USDC} and $${MAX_USDC}` },
      { status: 400 },
    );
  }

  const source = await getWhaleLivePositionById(body.positionId);
  if (!source) {
    return NextResponse.json({ error: "whale position is not live" }, { status: 404 });
  }

  const { position, whale } = source;
  if (position.status !== "open") {
    return NextResponse.json(
      { error: "whale position is not open" },
      { status: 409 },
    );
  }
  if (whale.status !== "active") {
    return NextResponse.json(
      { error: "whale is not active" },
      { status: 409 },
    );
  }
  if (!isSourceFresh(position.lastSeenAt.getTime())) {
    return NextResponse.json(
      { error: "whale position is stale" },
      { status: 409 },
    );
  }
  if (position.side !== "long" && position.side !== "short") {
    return NextResponse.json(
      { error: "unsupported whale position side" },
      { status: 409 },
    );
  }
  const marketInfo = await getMarketBySymbol(position.market);
  if (!marketInfo) {
    const error =
      position.source === "hyperliquid"
        ? `${position.market} is not available on Pacifica for copy trading`
        : `unknown Pacifica market: ${position.market}`;
    return NextResponse.json(
      { error },
      { status: 409 },
    );
  }
  const parsedMarketMaxLeverage = Number(marketInfo.max_leverage);
  const marketMaxLeverage =
    Number.isFinite(parsedMarketMaxLeverage) && parsedMarketMaxLeverage >= 1
      ? Math.floor(parsedMarketMaxLeverage)
      : 1;
  const requestedLeverage =
    body.leverage ?? Math.min(position.leverage, marketMaxLeverage);
  if (
    !Number.isFinite(requestedLeverage) ||
    requestedLeverage < 1 ||
    requestedLeverage > marketMaxLeverage
  ) {
    return NextResponse.json(
      {
        error: `leverage must be between 1x and market max ${marketMaxLeverage}x`,
      },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  const userNotional = body.stakeUsdc * requestedLeverage;
  const clamped = await clampLeverageForNotional(position.market, userNotional);
  const effectiveLeverage = Math.min(requestedLeverage, clamped);
  const finalNotional = body.stakeUsdc * effectiveLeverage;
  const sizingPrice = await resolveSizingPrice(position);
  if (!sizingPrice) {
    return NextResponse.json(
      { error: `Live price is unavailable for ${position.market}` },
      { status: 409 },
    );
  }
  const amountBase = lotSizedAmountFromNotional({
    notionalUsd: finalNotional,
    price: sizingPrice,
    lotSize: marketInfo.lot_size,
  });

  if (await hasOpenTailOnMarket(user.id, position.market)) {
    return NextResponse.json(
      { error: `you already have an open ${position.market} tail - close it first` },
      { status: 409 },
    );
  }

  const agent = await getAgentWallet(user.id);
  if (!agent) {
    try {
      const plan = await planOnboarding({
        userId: user.id,
        userMainPubkey: user.solanaPubkey,
        desiredStakeUsdc: body.stakeUsdc,
        leverage: effectiveLeverage,
      });
      return NextResponse.json({ phase: "onboard", ...plan });
    } catch (err) {
      const fundingError = fundingErrorResponse(err);
      if (fundingError) return fundingError;
      throw err;
    }
  }

  try {
    const depositPlan = await planPacificaDepositTopUp({
      userMainPubkey: user.solanaPubkey,
      stakeUsdc: body.stakeUsdc,
      leverage: effectiveLeverage,
    });
    if (depositPlan) {
      return NextResponse.json({ phase: "deposit", ...depositPlan });
    }
  } catch (err) {
    const fundingError = fundingErrorResponse(err);
    if (fundingError) return fundingError;
    console.error("[bet/whale] funding check failed:", err);
    return NextResponse.json(
      { error: `Pacifica funding check failed: ${String(err)}` },
      { status: 502 },
    );
  }

  const reserved = await reserveTailOnMarket(user.id, position.market);
  if (!reserved) {
    return NextResponse.json(
      { error: `you already have an open ${position.market} tail - close it first` },
      { status: 409 },
    );
  }

  let pendingBet: typeof bets.$inferSelect;
  try {
    [pendingBet] = await db
      .insert(bets)
      .values({
        userId: user.id,
        type: "copy",
        amountUsdc: body.stakeUsdc,
        status: "pending",
        meta: buildWhaleCopyMeta({
          whaleId: whale.id,
          source: position.source,
          sourceAccount: position.sourceAccount,
          sourcePositionId: position.id,
          leaderMarket: position.market,
          leaderSide: position.side,
          leverage: effectiveLeverage,
          autoCloseOnSourceClose: body.autoCloseOnSourceClose,
          userEntryPrice: 0,
          sourceEntryPriceAtCopy: position.entryPrice,
          pacificaOrderId: "pending",
        }),
      })
      .returning();
    if (!pendingBet) {
      throw new Error("pending bet insert returned no row");
    }
  } catch (err) {
    await releaseReservationBestEffort(user.id, position.market);
    console.error("[bet/whale] pending ledger insert failed:", err);
    return NextResponse.json(
      { error: "Could not prepare whale copy bet" },
      { status: 502 },
    );
  }

  let fill;
  try {
    fill = await openCopyOrder({
      agent,
      symbol: position.market,
      side: position.side,
      amountBase,
    });
  } catch (err) {
    await markBetFailedBestEffort(pendingBet.id);
    await releaseReservationBestEffort(user.id, position.market);
    console.error("[bet/whale] open failed:", err);
    return NextResponse.json(
      { error: `Pacifica order failed: ${String(err)}` },
      { status: 502 },
    );
  }

  let bet: typeof bets.$inferSelect;
  try {
    const avgFillPrice = Number(fill.avg_fill_price);
    [bet] = await db
      .update(bets)
      .set({
        status: "confirmed",
        meta: buildWhaleCopyMeta({
          whaleId: whale.id,
          source: position.source,
          sourceAccount: position.sourceAccount,
          sourcePositionId: position.id,
          leaderMarket: position.market,
          leaderSide: position.side,
          leverage: effectiveLeverage,
          autoCloseOnSourceClose: body.autoCloseOnSourceClose,
          userEntryPrice: Number.isFinite(avgFillPrice)
            ? avgFillPrice
            : sizingPrice,
          sourceEntryPriceAtCopy: position.entryPrice,
          pacificaOrderId: fill.order_id ?? "unknown",
        }),
      })
      .where(eq(bets.id, pendingBet.id))
      .returning();
    if (!bet) {
      throw new Error("confirmed bet update returned no row");
    }
  } catch (err) {
    console.error("[bet/whale] ledger update failed:", err);
    try {
      await closeCopyOrder({
        agent,
        symbol: position.market,
        positionSide: position.side,
        amountBase,
      });
    } catch (closeErr) {
      console.error("[bet/whale] compensation close failed:", closeErr);
      await markBetManualReviewBestEffort(pendingBet.id);
      await blockReservationBestEffort(user.id, position.market);
      return NextResponse.json(
        {
          error:
            "Whale copy opened but could not be recorded or auto-closed. Manual review required.",
        },
        { status: 502 },
      );
    }
    await markBetFailedBestEffort(pendingBet.id);
    await releaseReservationBestEffort(user.id, position.market);
    return NextResponse.json(
      { error: "Could not confirm whale copy bet" },
      { status: 502 },
    );
  }

  await releaseReservationBestEffort(user.id, position.market);

  return NextResponse.json({
    phase: "open",
    betId: bet.id,
    fill: {
      orderId: fill.order_id,
      avgFillPrice: fill.avg_fill_price,
      filledAmount: fill.filled_amount,
      side: fill.side,
    },
    source: {
      whaleId: whale.id,
      displayName: whale.displayName,
      asset: position.market,
      side: position.side,
      leverage: effectiveLeverage,
      autoCloseOnSourceClose: body.autoCloseOnSourceClose,
    },
  });
}
