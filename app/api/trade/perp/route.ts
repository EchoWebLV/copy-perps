import { NextResponse } from "next/server";
import {
  InsufficientAppFundsError,
  PacificaDepositPendingError,
  PacificaDepositSettlingError,
  PacificaFundingRateLimitError,
  isPacificaFundingRateLimitError,
  planPacificaDepositTopUp,
} from "@/lib/bets/funding";
import { planOnboarding } from "@/lib/bets/onboard";
import { marketDataErrorResponse } from "@/lib/bets/route-errors";
import { getMark } from "@/lib/data/marks";
import { getPositions } from "@/lib/pacifica/client";
import { clampLeverageForNotional, getMarketBySymbol } from "@/lib/pacifica/markets";
import { openCopyOrder } from "@/lib/pacifica/orders";
import { lotSizedAmountFromNotional } from "@/lib/pacifica/sizing";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { getAgentWallet } from "@/lib/wallets/agent";
import { getFlashV2Venue } from "@/lib/flash-v2/resolve";
import { FlashV2PositionConflictError, planFlashV2Open } from "@/lib/flash-v2/self-trade";
import { hasOpenTailOnMarket } from "@/lib/bets/copy-guard";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MIN_USDC = 1;
const MAX_USDC = 1000;
const MAX_FLASH_V2_LEVERAGE = 500; // venue builds up to 500x (degen); confirmed live.

interface Body {
  market?: string;
  side?: "long" | "short";
  stakeUsdc?: number;
  leverage?: number;
  walletAddress?: string;
}

function fundingErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof InsufficientAppFundsError) {
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

function parseMarket(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const market = value.trim().toUpperCase();
  return market.length > 0 ? market : null;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  const market = parseMarket(body?.market);
  if (
    !market ||
    (body?.side !== "long" && body?.side !== "short") ||
    typeof body.stakeUsdc !== "number" ||
    typeof body.leverage !== "number" ||
    !body.walletAddress
  ) {
    return NextResponse.json(
      { error: "market, side (long|short), stakeUsdc, leverage, walletAddress required" },
      { status: 400 },
    );
  }
  if (
    !Number.isFinite(body.stakeUsdc) ||
    body.stakeUsdc < MIN_USDC ||
    body.stakeUsdc > MAX_USDC
  ) {
    return NextResponse.json(
      { error: `stake must be between $${MIN_USDC} and $${MAX_USDC}` },
      { status: 400 },
    );
  }

  // Flash v2 self-directed open (user-signed, no session). When the flag is off
  // this branch is skipped and the Pacifica path below runs byte-for-byte.
  const flashV2 = getFlashV2Venue();
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
    const u = await ensureUser(claims.userId, body.walletAddress);
    if (!u.solanaPubkey) {
      return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
    }
    // A self-directed open and a copy/whale/bot tail both execute on the same
    // Flash v2 account, which nets by (account, symbol): a second position on a
    // market that already has a DB-tracked tail would merge into it, and a later
    // close would misattribute PnL. planFlashV2Open re-checks on-chain, but that
    // read can lag a just-opened tail; this DB guard closes the (user, market)
    // tail direction. The residual self-vs-self concurrent race needs a real
    // reservation, which belongs with the client-ER-signing slice (this route is
    // not yet wired to a live open caller).
    if (await hasOpenTailOnMarket(u.id, market, "flash-v2")) {
      return NextResponse.json(
        { error: `you already have an open ${market} tail - close it first` },
        { status: 409 },
      );
    }
    try {
      const plan = await planFlashV2Open({
        venue: flashV2,
        owner: u.solanaPubkey,
        market,
        side: body.side,
        stakeUsdc: body.stakeUsdc,
        leverage: body.leverage,
      });
      return NextResponse.json(plan);
    } catch (err) {
      if (err instanceof FlashV2PositionConflictError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      console.error("[trade/perp] flash-v2 open failed:", err);
      return NextResponse.json(
        { error: "Trade could not open. No funds were spent." },
        { status: 502 },
      );
    }
  }

  let marketInfo;
  try {
    marketInfo = await getMarketBySymbol(market);
  } catch (err) {
    const marketError = marketDataErrorResponse(err);
    if (marketError) return marketError;
    console.error("[trade/perp] market lookup failed:", err);
    return NextResponse.json(
      { error: "Could not load market data. Try again." },
      { status: 502 },
    );
  }
  if (!marketInfo) {
    return NextResponse.json(
      { error: `${market} is not available for self trading` },
      { status: 409 },
    );
  }

  const marketMaxLeverage = Math.max(1, Math.floor(Number(marketInfo.max_leverage)));
  if (
    !Number.isFinite(body.leverage) ||
    body.leverage < 1 ||
    body.leverage > marketMaxLeverage
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

  try {
    const openPositions = await getPositions(user.solanaPubkey);
    if (openPositions.some((p) => p.symbol === market)) {
      return NextResponse.json(
        { error: `you already have an open ${market} position - close it first` },
        { status: 409 },
      );
    }
  } catch (err) {
    console.error("[trade/perp] open position check failed:", err);
    return NextResponse.json(
      { error: "Could not check existing positions. Try again." },
      { status: 502 },
    );
  }

  const requestedNotional = body.stakeUsdc * body.leverage;
  let effectiveLeverage: number;
  try {
    const clamped = await clampLeverageForNotional(market, requestedNotional);
    effectiveLeverage = Math.min(body.leverage, clamped);
  } catch (err) {
    const marketError = marketDataErrorResponse(err);
    if (marketError) return marketError;
    console.error("[trade/perp] leverage lookup failed:", err);
    return NextResponse.json(
      { error: "Could not load leverage data. Try again." },
      { status: 502 },
    );
  }

  const mark = await getMark(market).catch((err) => {
    console.warn("[trade/perp] mark lookup failed:", err);
    return null;
  });
  if (!mark) {
    return NextResponse.json(
      { error: `Live price is unavailable for ${market}` },
      { status: 409 },
    );
  }

  const amountBase = lotSizedAmountFromNotional({
    notionalUsd: body.stakeUsdc * effectiveLeverage,
    price: mark,
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
    console.error("[trade/perp] funding check failed:", err);
    return NextResponse.json(
      { error: "Could not check your trading balance. Try again." },
      { status: 502 },
    );
  }

  try {
    const fill = await openCopyOrder({
      agent,
      symbol: market,
      side: body.side,
      amountBase,
    });
    return NextResponse.json({
      phase: "open",
      fill: {
        orderId: fill.order_id,
        avgFillPrice: fill.avg_fill_price,
        filledAmount: fill.filled_amount,
        side: fill.side,
      },
      trade: {
        market,
        side: body.side,
        leverage: effectiveLeverage,
        stakeUsdc: body.stakeUsdc,
      },
    });
  } catch (err) {
    console.error("[trade/perp] open failed:", err);
    if (isPacificaFundingRateLimitError(err)) {
      return NextResponse.json(
        {
          error: "Trading venue is busy. Retrying shortly.",
          retryable: true,
          retryAfterMs:
            err instanceof PacificaFundingRateLimitError ? err.retryAfterMs : 5000,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Trade could not open. No funds were spent." },
      { status: 502 },
    );
  }
}
