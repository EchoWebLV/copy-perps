import { NextResponse } from "next/server";
import {
  FLASH_MIN_NOTIONAL_USD,
  FlashPerpsError,
  getFlashPerpsService,
  isSupportedFlashMarket,
  type FlashSide,
} from "@/lib/flash/perps";
import {
  flashLeverageBoundsForMarket,
  normalizeFlashMarket,
  type FlashTradeMode,
} from "@/lib/flash/markets";
import { signAndSendPrivySolanaTransaction } from "@/lib/privy/instant-solana";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MIN_USDC = 1;
const MAX_USDC = 1000;
const USDC_ATOMS_PER_USDC = 1_000_000;

interface Body {
  market?: string;
  side?: FlashSide;
  stakeUsdc?: number;
  leverage?: number;
  walletAddress?: string;
  instant?: boolean;
  mode?: FlashTradeMode;
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
  InvalidTrigger: 400,
};

function parseMarket(value: unknown) {
  const market = normalizeFlashMarket(value);
  return market && isSupportedFlashMarket(market) ? market : null;
}

function parseMode(value: unknown): FlashTradeMode {
  return value === "degen" ? "degen" : "standard";
}

function errorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return "";
}

function flashWalletShortfallMessage(err: unknown): string | null {
  const match = /Insufficient Funds need more (\d+) tokens/i.exec(errorMessage(err));
  if (!match) return null;

  const amount = Number(match[1]) / USDC_ATOMS_PER_USDC;
  if (!Number.isFinite(amount) || amount <= 0) {
    return "Need more USDC in wallet for this Flash trade.";
  }
  return `Need $${amount.toFixed(2)} more USDC in wallet for this Flash trade.`;
}

function flashErrorResponse(err: unknown): NextResponse {
  const walletShortfall = flashWalletShortfallMessage(err);
  if (walletShortfall) {
    return NextResponse.json({ error: walletShortfall }, { status: 400 });
  }

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
  if (!Number.isFinite(body.stakeUsdc) || body.stakeUsdc < MIN_USDC || body.stakeUsdc > MAX_USDC) {
    return NextResponse.json(
      { error: `stake must be between $${MIN_USDC} and $${MAX_USDC}` },
      { status: 400 },
    );
  }
  const mode = parseMode(body.mode);
  const leverageBounds = flashLeverageBoundsForMarket(market, mode);
  if (!leverageBounds) {
    return NextResponse.json({ error: "unsupported Flash market" }, { status: 400 });
  }
  if (
    !Number.isFinite(body.leverage) ||
    body.leverage < leverageBounds.min ||
    body.leverage > leverageBounds.max
  ) {
    return NextResponse.json(
      {
        error: `leverage must be between ${leverageBounds.min}x and ${leverageBounds.max}x`,
      },
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
      mode,
    });
    if (body.instant) {
      const sent = await signAndSendPrivySolanaTransaction({
        privyUserId: claims.userId,
        walletAddress: user.solanaPubkey,
        transactionB64: result.transaction,
      });
      return NextResponse.json({
        phase: "sent",
        venue: "flash",
        signature: sent.signature,
        caip2: sent.caip2,
        quote: result.quote,
        position: result.position,
        trade: {
          market,
          side: body.side,
          stakeUsdc: body.stakeUsdc,
          leverage: body.leverage,
          mode,
        },
      });
    }
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
        mode,
      },
    });
  } catch (err) {
    return flashErrorResponse(err);
  }
}
