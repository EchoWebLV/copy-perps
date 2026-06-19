import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bets } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { hasOpenTailOnMarket } from "@/lib/bets/copy-guard";
import {
  reserveTailOnMarket,
  releaseTailReservation,
} from "@/lib/bets/tail-reservation";
import { getFlashV2Venue } from "@/lib/flash-v2/resolve";
import { FlashV2PositionConflictError } from "@/lib/flash-v2/self-trade";
import { openCopyFlashV2 } from "@/lib/bets/copy-flash-v2";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MIN_USDC = 5;
const MAX_USDC = 1000;
const MAX_LEVERAGE = 100;

interface Body {
  botId?: string;
  botName?: string;
  market?: string;
  side?: "long" | "short";
  leverage?: number;
  stakeUsdc?: number;
  sourcePositionId?: string | null;
  autoCloseOnSourceClose?: boolean;
  walletAddress?: string;
}

async function releaseReservationBestEffort(userId: string, market: string) {
  try {
    await releaseTailReservation(userId, market);
  } catch (err) {
    console.error("[bet/bot] reservation release failed:", err);
  }
}

/**
 * Open a Flash v2 tail that mirrors an LLM-arena bot's position. Bot-position
 * based (no Pacifica leader address), so it can't ride /api/bet/copy. Session-
 * signed (one-tap) via openCopyFlashV2 — which inherits the on-chain conflict
 * guard + ER confirmation. Writes a type='copy' bet with meta.botId so the
 * portfolio renders it as a bot tail and the mirror-close sweep can auto-close
 * it once a positive arena flat signal is wired. v2-only: with the flag off the
 * client opens bot tails through the legacy /api/flash/perp rail instead.
 */
export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const flashV2 = getFlashV2Venue();
  if (!flashV2) {
    return NextResponse.json({ error: "not available" }, { status: 404 });
  }

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
  if (!Number.isFinite(body.leverage) || body.leverage < 1 || body.leverage > MAX_LEVERAGE) {
    return NextResponse.json(
      { error: `leverage must be between 1x and ${MAX_LEVERAGE}x` },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  if (await hasOpenTailOnMarket(user.id, body.market, "flash-v2")) {
    return NextResponse.json(
      { error: `you already have an open ${body.market} tail — close it first` },
      { status: 409 },
    );
  }

  // Atomic lock across the async open so two concurrent same-(user, market) taps
  // can't both net into one on-chain position.
  const reserved = await reserveTailOnMarket(user.id, body.market);
  if (!reserved) {
    return NextResponse.json(
      { error: `you already have an open ${body.market} tail — close it first` },
      { status: 409 },
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
    await releaseReservationBestEffort(user.id, body.market);
    if (err instanceof FlashV2PositionConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[bet/bot] flash-v2 open failed:", err);
    return NextResponse.json(
      { error: "Trade could not open. No funds were spent." },
      { status: 502 },
    );
  }
  if (result.kind === "enable-session") {
    await releaseReservationBestEffort(user.id, body.market);
    return NextResponse.json({ phase: "enable-session" });
  }
  if (result.kind === "onboard") {
    await releaseReservationBestEffort(user.id, body.market);
    return NextResponse.json({ phase: "onboard", steps: result.steps });
  }

  const feeUsdc =
    result.quote.feeUsdUi != null && Number.isFinite(result.quote.feeUsdUi)
      ? result.quote.feeUsdUi
      : null;
  let bet: typeof bets.$inferSelect;
  try {
    [bet] = await db
      .insert(bets)
      .values({
        userId: user.id,
        type: "copy",
        amountUsdc: body.stakeUsdc,
        feeUsdc,
        status: "confirmed",
        meta: {
          venue: "flash-v2",
          botId: body.botId,
          botName: body.botName ?? null,
          leaderMarket: body.market,
          leaderSide: body.side,
          leverage: body.leverage,
          autoCloseOnSourceClose: body.autoCloseOnSourceClose ?? true,
          sourcePositionId: body.sourcePositionId ?? null,
          openTxSig: result.signature,
        },
      })
      .returning();
    if (!bet) throw new Error("flash-v2 bot bet insert returned no row");
  } catch (err) {
    await releaseReservationBestEffort(user.id, body.market);
    console.error("[bet/bot] flash-v2 ledger insert failed:", err);
    return NextResponse.json(
      { error: "Could not record bot copy bet" },
      { status: 502 },
    );
  }

  await releaseReservationBestEffort(user.id, body.market);
  return NextResponse.json({
    phase: "open",
    betId: bet.id,
    txSig: result.signature,
    market: body.market,
    side: body.side,
    botId: body.botId,
  });
}
