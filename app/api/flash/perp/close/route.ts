import { NextResponse } from "next/server";
import {
  FlashPerpsError,
  getFlashPerpsService,
  isSupportedFlashMarket,
  type FlashSide,
} from "@/lib/flash/perps";
import { normalizeFlashMarket } from "@/lib/flash/markets";
import { signAndSendPrivySolanaTransaction } from "@/lib/privy/instant-solana";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface Body {
  market?: string;
  side?: FlashSide;
  walletAddress?: string;
  instant?: boolean;
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

function flashErrorResponse(err: unknown): NextResponse {
  if (err instanceof FlashPerpsError) {
    return NextResponse.json(
      { error: err.message },
      { status: FLASH_ERROR_STATUS[err.code] },
    );
  }
  console.error("[flash/perp/close] request failed:", err);
  return NextResponse.json(
    { error: "Flash close could not be prepared. Try again." },
    { status: 502 },
  );
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  const market = parseMarket(body?.market);
  if (!market || (body?.side !== "long" && body?.side !== "short") || !body.walletAddress) {
    return NextResponse.json(
      { error: "market, side (long|short), walletAddress required" },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  try {
    const result = await getFlashPerpsService().close({
      trader: user.solanaPubkey,
      market,
      side: body.side,
    });
    if (body.instant) {
      const sent = await signAndSendPrivySolanaTransaction({
        privyUserId: claims.userId,
        walletAddress: user.solanaPubkey,
        transactionB64: result.transaction,
      });
      return NextResponse.json({
        phase: "sent-close",
        venue: "flash",
        signature: sent.signature,
        caip2: sent.caip2,
        quote: result.quote,
        position: result.position,
        trade: {
          market,
          side: body.side,
        },
      });
    }
    return NextResponse.json({
      phase: "sign-close",
      venue: "flash",
      transactionB64: result.transaction,
      quote: result.quote,
      position: result.position,
      trade: {
        market,
        side: body.side,
      },
    });
  } catch (err) {
    return flashErrorResponse(err);
  }
}
