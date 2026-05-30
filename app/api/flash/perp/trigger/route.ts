import { NextResponse } from "next/server";
import {
  FlashPerpsError,
  getFlashPerpsService,
  isSupportedFlashMarket,
  type FlashSide,
} from "@/lib/flash/perps";
import { normalizeFlashMarket } from "@/lib/flash/markets";
import { validateTriggerRoi, type TriggerKind } from "@/lib/flash/triggers";
import { signAndSendPrivySolanaTransaction } from "@/lib/privy/instant-solana";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface PlaceBody {
  market?: string;
  side?: FlashSide;
  kind?: TriggerKind;
  roiPct?: number;
  orderId?: number;
  walletAddress?: string;
  instant?: boolean;
}

interface CancelBody {
  market?: string;
  side?: FlashSide;
  kind?: TriggerKind;
  orderId?: number;
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

function parseKind(value: unknown): TriggerKind | null {
  return value === "tp" || value === "sl" ? value : null;
}

function flashErrorResponse(err: unknown): NextResponse {
  if (err instanceof FlashPerpsError) {
    return NextResponse.json(
      { error: err.message },
      { status: FLASH_ERROR_STATUS[err.code] },
    );
  }
  console.error("[flash/perp/trigger] request failed:", err);
  return NextResponse.json(
    { error: "Trigger order could not be prepared. Try again." },
    { status: 502 },
  );
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as PlaceBody | null;
  const market = parseMarket(body?.market);
  const kind = parseKind(body?.kind);
  if (
    !market ||
    (body?.side !== "long" && body?.side !== "short") ||
    !kind ||
    typeof body.roiPct !== "number" ||
    !body.walletAddress
  ) {
    return NextResponse.json(
      { error: "market, side, kind (tp|sl), roiPct, walletAddress required" },
      { status: 400 },
    );
  }

  const validated = validateTriggerRoi(kind, body.roiPct);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.message }, { status: 400 });
  }

  const user = await ensureUser(claims.userId, body.walletAddress);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  try {
    const result = await getFlashPerpsService().buildPlaceTriggerOrderTx({
      trader: user.solanaPubkey,
      market,
      side: body.side,
      kind,
      roiPct: validated.roiPct,
      orderId: typeof body.orderId === "number" ? body.orderId : undefined,
    });
    if (body.instant) {
      const sent = await signAndSendPrivySolanaTransaction({
        privyUserId: claims.userId,
        walletAddress: user.solanaPubkey,
        transactionB64: result.transaction,
      });
      return NextResponse.json({
        phase: "sent-trigger",
        venue: "flash",
        signature: sent.signature,
        caip2: sent.caip2,
        kind,
        roiPct: validated.roiPct,
      });
    }
    return NextResponse.json({
      phase: "sign-trigger",
      venue: "flash",
      transactionB64: result.transaction,
      kind,
      roiPct: validated.roiPct,
    });
  } catch (err) {
    return flashErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as CancelBody | null;
  const market = parseMarket(body?.market);
  const kind = parseKind(body?.kind);
  if (
    !market ||
    (body?.side !== "long" && body?.side !== "short") ||
    !kind ||
    typeof body.orderId !== "number" ||
    !body.walletAddress
  ) {
    return NextResponse.json(
      { error: "market, side, kind (tp|sl), orderId, walletAddress required" },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  try {
    const result = await getFlashPerpsService().buildCancelTriggerOrderTx({
      trader: user.solanaPubkey,
      market,
      side: body.side,
      kind,
      orderId: body.orderId,
    });
    if (body.instant) {
      const sent = await signAndSendPrivySolanaTransaction({
        privyUserId: claims.userId,
        walletAddress: user.solanaPubkey,
        transactionB64: result.transaction,
      });
      return NextResponse.json({
        phase: "sent-trigger-cancel",
        venue: "flash",
        signature: sent.signature,
        caip2: sent.caip2,
        kind,
      });
    }
    return NextResponse.json({
      phase: "sign-trigger-cancel",
      venue: "flash",
      transactionB64: result.transaction,
      kind,
    });
  } catch (err) {
    return flashErrorResponse(err);
  }
}
