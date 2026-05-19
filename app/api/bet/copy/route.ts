import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bets } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { getAgentWallet } from "@/lib/wallets/agent";
import { getPositions } from "@/lib/pacifica/client";
import { clampLeverageForNotional } from "@/lib/pacifica/markets";
import { openCopyOrder } from "@/lib/pacifica/orders";
import { InsufficientWalletUsdcError } from "@/lib/pacifica/deposit";
import { planOnboarding } from "@/lib/bets/onboard";
import { planPacificaDepositTopUp } from "@/lib/bets/funding";
import { hasOpenTailOnMarket } from "@/lib/bets/copy-guard";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MIN_USDC = 5;
const MAX_USDC = 1000;

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
  if (err instanceof InsufficientWalletUsdcError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  return null;
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

  // One open tail per market: Pacifica nets positions by (account, symbol),
  // so a second tail on the same market would merge into one position —
  // closing one would close the other and misattribute its PnL.
  if (await hasOpenTailOnMarket(user.id, body.market)) {
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
      { error: `Pacifica leader lookup failed: ${String(err)}` },
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

  // Compute the user's notional + amount given their stake and leader's lev.
  const userNotional = body.stakeUsdc * body.leverage;
  const clamped = await clampLeverageForNotional(body.market, userNotional);
  const effectiveLeverage = Math.min(body.leverage, clamped);
  const finalNotional = body.stakeUsdc * effectiveLeverage;
  const entryPrice = Number(leaderPos.entry_price);
  const amountBase = (finalNotional / entryPrice).toFixed(6);

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
      { error: `Pacifica funding check failed: ${String(err)}` },
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
      { error: `Pacifica order failed: ${String(err)}` },
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
