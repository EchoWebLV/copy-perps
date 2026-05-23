import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { hasOpenTailOnMarket } from "@/lib/bets/copy-guard";
import {
  PacificaDepositPendingError,
  PacificaDepositSettlingError,
  planPacificaDepositTopUp,
} from "@/lib/bets/funding";
import {
  releaseTailReservation,
  reserveTailOnMarket,
} from "@/lib/bets/tail-reservation";
import { buildWhaleCopyMeta } from "@/lib/bets/whale-meta";
import { planOnboarding } from "@/lib/bets/onboard";
import { db } from "@/lib/db";
import { bets, whalePositions, whales } from "@/lib/db/schema";
import { whaleSocialEnabled } from "@/lib/features";
import { InsufficientWalletUsdcError } from "@/lib/pacifica/deposit";
import { clampLeverageForNotional, getMarketBySymbol } from "@/lib/pacifica/markets";
import { openCopyOrder } from "@/lib/pacifica/orders";
import { lotSizedAmountFromNotional } from "@/lib/pacifica/sizing";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { getAgentWallet } from "@/lib/wallets/agent";
import { isSourceFresh } from "@/lib/whales/identity";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MIN_USDC = 5;
const MAX_USDC = 1000;

interface Body {
  positionId?: string;
  stakeUsdc?: number;
  walletAddress?: string;
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
  return null;
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

  const rows = await db
    .select({ position: whalePositions, whale: whales })
    .from(whalePositions)
    .innerJoin(whales, eq(whalePositions.whaleId, whales.id))
    .where(eq(whalePositions.id, body.positionId))
    .limit(1);
  const source = rows[0];
  if (!source) {
    return NextResponse.json({ error: "whale position not found" }, { status: 404 });
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
  if (position.source !== "pacifica" || whale.source !== "pacifica") {
    return NextResponse.json(
      { error: "only Pacifica whale copying is supported" },
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

  const user = await ensureUser(claims.userId, body.walletAddress);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  const userNotional = body.stakeUsdc * position.leverage;
  const clamped = await clampLeverageForNotional(position.market, userNotional);
  const effectiveLeverage = Math.min(position.leverage, clamped);
  const finalNotional = body.stakeUsdc * effectiveLeverage;
  const marketInfo = await getMarketBySymbol(position.market);
  if (!marketInfo) {
    return NextResponse.json(
      { error: `unknown Pacifica market: ${position.market}` },
      { status: 409 },
    );
  }
  const amountBase = lotSizedAmountFromNotional({
    notionalUsd: finalNotional,
    price:
      typeof position.currentMark === "number" && position.currentMark > 0
        ? position.currentMark
        : position.entryPrice,
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

  let fill;
  try {
    fill = await openCopyOrder({
      agent,
      symbol: position.market,
      side: position.side,
      amountBase,
    });
  } catch (err) {
    await releaseTailReservation(user.id, position.market);
    console.error("[bet/whale] open failed:", err);
    return NextResponse.json(
      { error: `Pacifica order failed: ${String(err)}` },
      { status: 502 },
    );
  }

  let bet: typeof bets.$inferSelect;
  try {
    [bet] = await db
      .insert(bets)
      .values({
        userId: user.id,
        type: "copy",
        amountUsdc: body.stakeUsdc,
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
          userEntryPrice: Number(fill.avg_fill_price),
          sourceEntryPriceAtCopy: position.entryPrice,
          pacificaOrderId: fill.order_id,
        }),
      })
      .returning();
  } catch (err) {
    await releaseTailReservation(user.id, position.market);
    console.error("[bet/whale] ledger insert failed:", err);
    return NextResponse.json(
      { error: "Could not record whale copy bet" },
      { status: 502 },
    );
  }

  try {
    await releaseTailReservation(user.id, position.market);
  } catch (err) {
    console.warn("[bet/whale] reservation cleanup failed:", err);
  }

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
