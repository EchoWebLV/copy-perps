import { NextResponse } from "next/server";
import {
  FLASH_MIN_NOTIONAL_USD,
  FlashPerpsError,
  getFlashPerpsService,
  isSupportedFlashMarket,
  type FlashSide,
} from "@/lib/flash/perps";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MAX_USDC = 1000;

interface Body {
  market?: string;
  side?: FlashSide;
  stakeUsdc?: number;
  leverage?: number;
  walletAddress?: string;
}

const FLASH_ERROR_STATUS: Record<FlashPerpsError["code"], number> = {
  UnsupportedMarket: 400,
  TradeTooSmall: 400,
  InvalidAmount: 400,
  InvalidLeverage: 400,
  LeverageTooHigh: 400,
  PositionNotOpen: 404,
  QuoteFailed: 502,
  BuildTxFailed: 502,
};

function parseMarket(value: unknown) {
  if (typeof value !== "string") return null;
  const market = value.trim().toUpperCase();
  return isSupportedFlashMarket(market) ? market : null;
}

function flashErrorResponse(err: unknown): NextResponse {
  if (err instanceof FlashPerpsError) {
    return NextResponse.json(
      { error: err.message },
      { status: FLASH_ERROR_STATUS[err.code] },
    );
  }
  console.error("[flash/perp] request failed:", err);
  return NextResponse.json(
    { error: "Flash trade could not be prepared. Try again." },
    { status: 502 },
  );
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
  if (!Number.isFinite(body.stakeUsdc) || body.stakeUsdc <= 0 || body.stakeUsdc > MAX_USDC) {
    return NextResponse.json(
      { error: `stake must be between $1 and $${MAX_USDC}` },
      { status: 400 },
    );
  }
  if (!Number.isFinite(body.leverage) || body.leverage < 1 || body.leverage > 100) {
    return NextResponse.json(
      { error: "leverage must be between 1x and 100x" },
      { status: 400 },
    );
  }
  if (body.stakeUsdc * body.leverage < FLASH_MIN_NOTIONAL_USD) {
    return NextResponse.json(
      { error: `Flash minimum position is $${FLASH_MIN_NOTIONAL_USD} notional` },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  try {
    const result = await getFlashPerpsService().open({
      trader: user.solanaPubkey,
      market,
      side: body.side,
      amountUsd: body.stakeUsdc,
      leverage: body.leverage,
    });
    return NextResponse.json({
      phase: "sign",
      venue: "flash",
      transactionB64: result.transaction,
      quote: result.quote,
      position: result.position,
      trade: {
        market,
        side: body.side,
        stakeUsdc: body.stakeUsdc,
        leverage: body.leverage,
      },
    });
  } catch (err) {
    return flashErrorResponse(err);
  }
}
