import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bets } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { getAgentWallet } from "@/lib/wallets/agent";
import { getPositions } from "@/lib/pacifica/client";
import { clampLeverageForNotional, getMarketBySymbol } from "@/lib/pacifica/markets";
import { openCopyOrder } from "@/lib/pacifica/orders";
import { lotSizedAmountFromNotional } from "@/lib/pacifica/sizing";
import { InsufficientWalletUsdcError } from "@/lib/pacifica/deposit";
import { planOnboarding } from "@/lib/bets/onboard";
import {
  InsufficientAppFundsError,
  PacificaDepositPendingError,
  PacificaDepositSettlingError,
  PacificaFundingRateLimitError,
  isPacificaFundingRateLimitError,
  planPacificaDepositTopUp,
} from "@/lib/bets/funding";
import { hasOpenTailOnMarket } from "@/lib/bets/copy-guard";
import { marketDataErrorResponse } from "@/lib/bets/route-errors";
import { getFlashV2Venue } from "@/lib/flash-v2/resolve";
import { openCopyFlashV2 } from "@/lib/bets/copy-flash-v2";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MIN_USDC = 5;
const MAX_USDC = 1000;
const MAX_FLASH_V2_LEVERAGE = 100;

interface Body {
  leaderAddress?: string;
  market?: string;
  side?: "long" | "short";
  leverage?: number;
  stakeUsdc?: number;
  signalId?: string;
  walletAddress?: string;
}

function fundingErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof InsufficientAppFundsError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof InsufficientWalletUsdcError) {
    const additionalUsdc = Math.max(0, err.requiredUsdc - err.walletUsdc);
    return NextResponse.json(
      { error: `Add $${additionalUsdc.toFixed(2)} more USDC to trade.` },
      { status: 400 },
    );
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
        error: "Balance checks are busy. Retrying shortly.",
        retryable: true,
        retryAfterMs:
          err instanceof PacificaFundingRateLimitError ? err.retryAfterMs : 5000,
      },
      { status: 409 },
    );
  }
  return null;
}

function feeUsdcFromFill(fill: { fee?: unknown }): number | null {
  const fee = Number(fill.fee);
  return Number.isFinite(fee) ? fee : null;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (
    !body?.leaderAddress ||
    !body.market ||
    (body.side !== "long" && body.side !== "short") ||
    typeof body.leverage !== "number" ||
    typeof body.stakeUsdc !== "number"
  ) {
    return NextResponse.json(
      { error: "leaderAddress, market, side (long|short), leverage, stakeUsdc required" },
      { status: 400 },
    );
  }
  if (body.stakeUsdc < MIN_USDC || body.stakeUsdc > MAX_USDC) {
    return NextResponse.json(
      { error: `stake must be between $${MIN_USDC} and $${MAX_USDC}` },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  // Execution venue: Flash v2 when the flag is on, else Pacifica. The flag-off
  // path below is the unchanged Pacifica flow.
  const flashV2 = getFlashV2Venue();
  const copyVenue = flashV2 ? "flash-v2" : "pacifica";

  // One open tail per market+venue: each venue nets positions by (account,
  // symbol), so a second tail on the same market+venue would merge into one
  // position — closing one would close the other and misattribute its PnL.
  if (await hasOpenTailOnMarket(user.id, body.market, copyVenue)) {
    return NextResponse.json(
      { error: `you already have an open ${body.market} tail — close it first` },
      { status: 409 },
    );
  }

  // Re-verify the leader still holds the matching position.
  let leaderPositions;
  try {
    leaderPositions = await getPositions(body.leaderAddress);
  } catch (err) {
    return NextResponse.json(
      { error: "Source trader lookup failed. Try again." },
      { status: 502 },
    );
  }
  const leaderPos = leaderPositions.find(
    (p) =>
      p.symbol === body.market &&
      ((body.side === "long" && p.side === "bid") ||
        (body.side === "short" && p.side === "ask")),
  );
  if (!leaderPos) {
    return NextResponse.json(
      { error: "leader no longer has this position open" },
      { status: 409 },
    );
  }

  // Flash v2 copy: session-signed (one-tap), no agent wallet. The whole Pacifica
  // path below (sizing, agent onboarding, agent fill) is skipped when the flag
  // is on. Requires a bound session (else `enable-session`) + onboarded basket.
  if (flashV2) {
    if (
      !Number.isFinite(body.leverage) ||
      body.leverage < 1 ||
      body.leverage > MAX_FLASH_V2_LEVERAGE
    ) {
      return NextResponse.json(
        { error: `leverage must be between 1x and ${MAX_FLASH_V2_LEVERAGE}x` },
        { status: 400 },
      );
    }
    let result;
    try {
      result = await openCopyFlashV2({
        venue: flashV2,
        userId: user.id,
        owner: user.solanaPubkey,
        market: body.market,
        side: body.side,
        stakeUsdc: body.stakeUsdc,
        leverage: body.leverage,
      });
    } catch (err) {
      console.error("[bet/copy] flash-v2 open failed:", err);
      return NextResponse.json(
        { error: "Trade could not open. No funds were spent." },
        { status: 502 },
      );
    }
    if (result.kind === "enable-session") {
      return NextResponse.json({ phase: "enable-session" });
    }
    if (result.kind === "onboard") {
      return NextResponse.json({ phase: "onboard", steps: result.steps });
    }
    const feeUsdc =
      result.quote.feeUsdUi != null && Number.isFinite(result.quote.feeUsdUi)
        ? result.quote.feeUsdUi
        : null;
    const [bet] = await db
      .insert(bets)
      .values({
        userId: user.id,
        type: "copy",
        signalId: body.signalId ?? null,
        amountUsdc: body.stakeUsdc,
        feeUsdc,
        status: "confirmed",
        meta: {
          venue: "flash-v2",
          leaderAddress: body.leaderAddress,
          leaderMarket: body.market,
          leaderSide: body.side,
          leverage: body.leverage,
          leaderEntryPriceAtTap: Number(leaderPos.entry_price),
          openTxSig: result.signature,
        },
      })
      .returning();
    return NextResponse.json({
      phase: "open",
      betId: bet.id,
      txSig: result.signature,
      market: body.market,
      side: body.side,
    });
  }

  // Compute the user's notional + amount given their stake and leader's lev.
  const userNotional = body.stakeUsdc * body.leverage;
  let clamped: number;
  let marketInfo;
  try {
    clamped = await clampLeverageForNotional(body.market, userNotional);
    marketInfo = await getMarketBySymbol(body.market);
  } catch (err) {
    const marketError = marketDataErrorResponse(err);
    if (marketError) return marketError;
    console.error("[bet/copy] market data lookup failed:", err);
    return NextResponse.json(
      { error: "Could not load market data. Try again." },
      { status: 502 },
    );
  }
  const effectiveLeverage = Math.min(body.leverage, clamped);
  const finalNotional = body.stakeUsdc * effectiveLeverage;
  const entryPrice = Number(leaderPos.entry_price);
  if (!marketInfo) {
    return NextResponse.json(
      { error: `${body.market} is not available for copy trading` },
      { status: 409 },
    );
  }
  const amountBase = lotSizedAmountFromNotional({
    notionalUsd: finalNotional,
    price: entryPrice,
    lotSize: marketInfo.lot_size,
  });

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
    console.error("[bet/copy] funding check failed:", err);
    return NextResponse.json(
      { error: "Could not check your trading balance. Try again." },
      { status: 502 },
    );
  }

  let fill;
  try {
    fill = await openCopyOrder({
      agent,
      symbol: body.market,
      side: body.side,
      amountBase,
    });
  } catch (err) {
    console.error("[bet/copy] open failed:", err);
    return NextResponse.json(
      { error: "Trade could not open. No funds were spent." },
      { status: 502 },
    );
  }

  const [bet] = await db
    .insert(bets)
    .values({
      userId: user.id,
      type: "copy",
      signalId: body.signalId ?? null,
      amountUsdc: body.stakeUsdc,
      feeUsdc: feeUsdcFromFill(fill),
      status: "confirmed",
      meta: {
        leaderAddress: body.leaderAddress,
        leaderMarket: body.market,
        leaderSide: body.side,
        leverage: effectiveLeverage,
        pacificaOrderId: fill.order_id,
        leaderEntryPriceAtTap: Number(leaderPos.entry_price),
      },
    })
    .returning();

  return NextResponse.json({
    phase: "open",
    betId: bet.id,
    fill: {
      orderId: fill.order_id,
      avgFillPrice: fill.avg_fill_price,
      filledAmount: fill.filled_amount,
      side: fill.side,
    },
  });
}
