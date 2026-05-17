import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bets } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { getAgentWallet } from "@/lib/wallets/agent";
import { clampLeverageForNotional } from "@/lib/pacifica/markets";
import { openCopyOrder } from "@/lib/pacifica/orders";
import { planOnboarding } from "@/lib/bets/onboard";
import { fetchOpenPositionForBot } from "@/lib/bots/paper";
import { getBot } from "@/lib/bots";
import { hasOpenTailOnMarket } from "@/lib/bets/copy-guard";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MIN_USDC = 5;
const MAX_USDC = 1000;

interface Body {
  botId?: string;
  market?: string;
  side?: "long" | "short";
  leverage?: number;
  stakeUsdc?: number;
  walletAddress?: string;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (
    !body?.botId ||
    !body.market ||
    (body.side !== "long" && body.side !== "short") ||
    typeof body.leverage !== "number" ||
    typeof body.stakeUsdc !== "number"
  ) {
    return NextResponse.json(
      { error: "botId, market, side (long|short), leverage, stakeUsdc required" },
      { status: 400 },
    );
  }
  if (body.stakeUsdc < MIN_USDC || body.stakeUsdc > MAX_USDC) {
    return NextResponse.json(
      { error: `stake must be between $${MIN_USDC} and $${MAX_USDC}` },
      { status: 400 },
    );
  }

  const bot = getBot(body.botId);
  if (!bot) {
    return NextResponse.json({ error: "unknown bot" }, { status: 404 });
  }

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  // First-tap onboarding (identical to /api/bet/copy flow)
  const agent = await getAgentWallet(user.id);
  if (!agent) {
    const plan = await planOnboarding({
      userId: user.id,
      userMainPubkey: user.solanaPubkey,
      desiredStakeUsdc: body.stakeUsdc,
    });
    return NextResponse.json({ phase: "onboard", ...plan });
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

  // Re-fetch the bot's current paper position to validate the user is
  // copying what's currently open.
  const paperPos = await fetchOpenPositionForBot(body.botId);
  if (!paperPos) {
    return NextResponse.json(
      { error: "bot has no open position" },
      { status: 409 },
    );
  }
  if (paperPos.asset !== body.market) {
    return NextResponse.json(
      { error: "market mismatch with bot's current position" },
      { status: 409 },
    );
  }
  if (paperPos.side !== body.side) {
    return NextResponse.json(
      { error: "side mismatch with bot's current position" },
      { status: 409 },
    );
  }

  // Scale stake → notional using the bot's leverage (clamped by Pacifica
  // per-market max).
  const userNotional = body.stakeUsdc * paperPos.leverage;
  const clamped = await clampLeverageForNotional(body.market, userNotional);
  const effectiveLeverage = Math.min(paperPos.leverage, clamped);
  const finalNotional = body.stakeUsdc * effectiveLeverage;
  const amountBase = (finalNotional / paperPos.entryMark).toFixed(6);

  // Open the real Pacifica order
  let fill;
  try {
    fill = await openCopyOrder({
      agent,
      symbol: body.market,
      side: body.side,
      amountBase,
    });
  } catch (err) {
    console.error("[bet/bot] open failed:", err);
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
      amountUsdc: body.stakeUsdc,
      status: "confirmed",
      meta: {
        botId: body.botId,
        botPaperPositionId: paperPos.id,
        leaderMarket: body.market,
        leaderSide: body.side,
        leverage: effectiveLeverage,
        pacificaOrderId: fill.order_id,
        botEntryMarkAtTap: paperPos.entryMark,
        userFillPriceAtTap: Number(fill.avg_fill_price),
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
