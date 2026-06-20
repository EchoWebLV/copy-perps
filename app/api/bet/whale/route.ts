import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { hasOpenTailOnMarket } from "@/lib/bets/copy-guard";
import {
  InsufficientAppFundsError,
  PacificaDepositPendingError,
  PacificaDepositSettlingError,
  PacificaFundingRateLimitError,
  isPacificaFundingRateLimitError,
  planPacificaDepositTopUp,
} from "@/lib/bets/funding";
import { marketDataErrorResponse } from "@/lib/bets/route-errors";
import {
  blockTailReservation,
  releaseTailReservation,
  reserveTailOnMarket,
} from "@/lib/bets/tail-reservation";
import { buildWhaleCopyMeta } from "@/lib/bets/whale-meta";
import { planOnboarding } from "@/lib/bets/onboard";
import { getMark } from "@/lib/data/marks";
import { db } from "@/lib/db";
import { bets } from "@/lib/db/schema";
import { whaleSocialEnabled } from "@/lib/features";
import { InsufficientWalletUsdcError } from "@/lib/pacifica/deposit";
import { clampLeverageForNotional, getMarketBySymbol } from "@/lib/pacifica/markets";
import { closeCopyOrder, openCopyOrder } from "@/lib/pacifica/orders";
import { lotSizedAmountFromNotional } from "@/lib/pacifica/sizing";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { getAgentWallet } from "@/lib/wallets/agent";
import { isSourceFresh } from "@/lib/whales/identity";
import { getWhaleLivePositionById } from "@/lib/whales/live-cache";
import { getFlashV2Venue } from "@/lib/flash-v2/resolve";
import { MAX_FLASH_V2_LEVERAGE } from "@/lib/flash-v2/constants";
import { FlashV2PositionConflictError } from "@/lib/flash-v2/self-trade";
import { openCopyFlashV2 } from "@/lib/bets/copy-flash-v2";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MIN_USDC = 1;
const MAX_USDC = 1000;

interface Body {
  positionId?: string;
  snapshot?: WhaleSnapshotBody;
  stakeUsdc?: number;
  walletAddress?: string;
  leverage?: number;
  autoCloseOnSourceClose?: boolean;
  preflightOnly?: boolean;
}

interface WhaleSnapshotBody {
  sourcePositionId?: string;
  whaleId?: string;
  source?: string;
  sourceAccount?: string;
  displayName?: string;
  market?: string;
  side?: string;
  leverage?: number;
  maxLeverage?: number | null;
  entryPrice?: number;
  currentMark?: number | null;
  lastSeenAtMs?: number;
}

type WhaleTailCandidate = {
  detachedFromSource: boolean;
  position: {
    id: string;
    whaleId: string;
    source: "pacifica" | "hyperliquid";
    sourceAccount: string;
    market: string;
    side: "long" | "short";
    leverage: number;
    entryPrice: number;
    currentMark: number | null;
    status: string;
    lastSeenAt: Date;
  };
  whale: {
    id: string;
    source: "pacifica" | "hyperliquid";
    sourceAccount: string;
    displayName: string;
    status: string;
  };
};

type CandidateResult =
  | { candidate: WhaleTailCandidate }
  | { response: NextResponse };

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

async function releaseReservationBestEffort(userId: string, market: string) {
  try {
    await releaseTailReservation(userId, market);
  } catch (err) {
    console.warn("[bet/whale] reservation cleanup failed:", err);
  }
}

async function markBetFailedBestEffort(betId: string) {
  try {
    await db.update(bets).set({ status: "failed" }).where(eq(bets.id, betId));
  } catch (err) {
    console.warn("[bet/whale] failed bet update failed:", err);
  }
}

async function markBetManualReviewBestEffort(betId: string) {
  try {
    await db
      .update(bets)
      .set({ status: "manual_review" })
      .where(eq(bets.id, betId));
  } catch (err) {
    console.warn("[bet/whale] manual review bet update failed:", err);
  }
}

async function blockReservationBestEffort(userId: string, market: string) {
  try {
    await blockTailReservation(userId, market);
  } catch (err) {
    console.warn("[bet/whale] reservation block failed:", err);
  }
}

async function resolveSizingPrice(position: {
  currentMark: number | null;
  market: string;
}) {
  if (typeof position.currentMark === "number" && position.currentMark > 0) {
    return position.currentMark;
  }
  const mark = await getMark(position.market);
  return typeof mark === "number" && mark > 0 ? mark : null;
}

function parseWhaleSource(value: unknown): "pacifica" | "hyperliquid" | null {
  return value === "pacifica" || value === "hyperliquid" ? value : null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function parseSnapshotCandidate(
  snapshot: WhaleSnapshotBody | undefined,
): WhaleTailCandidate | null {
  const source = parseWhaleSource(snapshot?.source);
  const sourcePositionId = snapshot?.sourcePositionId;
  const whaleId = snapshot?.whaleId;
  const sourceAccount = snapshot?.sourceAccount;
  const displayName = snapshot?.displayName;
  const market = snapshot?.market?.trim().toUpperCase();
  const side = snapshot?.side;
  const leverage = positiveNumber(snapshot?.leverage);
  const entryPrice = positiveNumber(snapshot?.entryPrice);
  const currentMark =
    snapshot?.currentMark === null ? null : positiveNumber(snapshot?.currentMark);
  const lastSeenAtMs =
    typeof snapshot?.lastSeenAtMs === "number" &&
    Number.isFinite(snapshot.lastSeenAtMs)
      ? snapshot.lastSeenAtMs
      : Date.now();

  if (
    !source ||
    typeof sourcePositionId !== "string" ||
    sourcePositionId.length === 0 ||
    typeof whaleId !== "string" ||
    whaleId.length === 0 ||
    typeof sourceAccount !== "string" ||
    sourceAccount.length === 0 ||
    typeof displayName !== "string" ||
    displayName.length === 0 ||
    !market ||
    (side !== "long" && side !== "short") ||
    leverage === null ||
    entryPrice === null
  ) {
    return null;
  }

  return {
    detachedFromSource: true,
    position: {
      id: sourcePositionId,
      whaleId,
      source,
      sourceAccount,
      market,
      side,
      leverage,
      entryPrice,
      currentMark,
      status: "open",
      lastSeenAt: new Date(lastSeenAtMs),
    },
    whale: {
      id: whaleId,
      source,
      sourceAccount,
      displayName,
      status: "active",
    },
  };
}

function liveCandidate(
  source: Awaited<ReturnType<typeof getWhaleLivePositionById>>,
): WhaleTailCandidate | null {
  if (!source) return null;
  const { position, whale } = source;
  if (position.side !== "long" && position.side !== "short") return null;
  if (position.source !== "pacifica" && position.source !== "hyperliquid") {
    return null;
  }
  if (whale.source !== "pacifica" && whale.source !== "hyperliquid") {
    return null;
  }

  return {
    detachedFromSource: false,
    position: {
      id: position.id,
      whaleId: position.whaleId,
      source: position.source,
      sourceAccount: position.sourceAccount,
      market: position.market,
      side: position.side,
      leverage: position.leverage,
      entryPrice: position.entryPrice,
      currentMark: position.currentMark,
      status: position.status,
      lastSeenAt: position.lastSeenAt,
    },
    whale: {
      id: whale.id,
      source: whale.source,
      sourceAccount: whale.sourceAccount,
      displayName: whale.displayName,
      status: whale.status,
    },
  };
}

async function resolveWhaleTailCandidate(body: Body): Promise<CandidateResult> {
  const source = body.positionId
    ? await getWhaleLivePositionById(body.positionId)
    : null;
  const live = liveCandidate(source);

  if (
    live &&
    live.position.status === "open" &&
    live.whale.status === "active" &&
    isSourceFresh(live.position.lastSeenAt.getTime())
  ) {
    return { candidate: live };
  }

  const snapshot = parseSnapshotCandidate(body.snapshot);
  if (snapshot) return { candidate: snapshot };

  if (!live) {
    return {
      response: NextResponse.json(
        { error: "whale position is not live" },
        { status: 404 },
      ),
    };
  }
  if (live.position.status !== "open") {
    return {
      response: NextResponse.json(
        { error: "whale position is not open" },
        { status: 409 },
      ),
    };
  }
  if (live.whale.status !== "active") {
    return {
      response: NextResponse.json(
        { error: "whale is not active" },
        { status: 409 },
      ),
    };
  }
  if (!isSourceFresh(live.position.lastSeenAt.getTime())) {
    return {
      response: NextResponse.json(
        { error: "whale position is stale" },
        { status: 409 },
      ),
    };
  }

  return {
    response: NextResponse.json(
      { error: "unsupported whale position side" },
      { status: 409 },
    ),
  };
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

  const resolved = await resolveWhaleTailCandidate(body);
  if ("response" in resolved) return resolved.response;

  const { position, whale, detachedFromSource } = resolved.candidate;
  const sourceAutoClose = detachedFromSource
    ? false
    : body.autoCloseOnSourceClose;

  let marketInfo;
  try {
    marketInfo = await getMarketBySymbol(position.market);
  } catch (err) {
    const marketError = marketDataErrorResponse(err);
    if (marketError) return marketError;
    console.error("[bet/whale] market data lookup failed:", err);
    return NextResponse.json(
      { error: "Could not load market data. Try again." },
      { status: 502 },
    );
  }
  if (!marketInfo) {
    return NextResponse.json(
      { error: `${position.market} is not available for copy trading` },
      { status: 409 },
    );
  }
  // Execution venue decides the leverage ceiling, so resolve it BEFORE
  // validating. Flash v2 (the live whale rail) builds up to MAX_FLASH_V2_LEVERAGE
  // (degen); Pacifica is bounded by the market's own max_leverage (e.g. BTC 50x).
  // Without this, a 500x copy that actually executes on Flash v2 was wrongly
  // rejected by the Pacifica cap.
  const flashV2 = getFlashV2Venue();
  const copyVenue = flashV2 ? "flash-v2" : "pacifica";
  const parsedMarketMaxLeverage = Number(marketInfo.max_leverage);
  const pacificaMaxLeverage =
    Number.isFinite(parsedMarketMaxLeverage) && parsedMarketMaxLeverage >= 1
      ? Math.floor(parsedMarketMaxLeverage)
      : 1;
  const marketMaxLeverage = flashV2 ? MAX_FLASH_V2_LEVERAGE : pacificaMaxLeverage;
  const requestedLeverage =
    body.leverage ?? Math.min(position.leverage, marketMaxLeverage);
  if (
    !Number.isFinite(requestedLeverage) ||
    requestedLeverage < 1 ||
    requestedLeverage > marketMaxLeverage
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

  // Flash v2 enforces its own per-market ceiling at the venue, and the 500x cap
  // is already applied above. Pacifica's notional-tier clamp would wrongly
  // re-cap a Flash v2 copy at the Pacifica market max (e.g. BTC 50x), so it only
  // runs on the Pacifica path.
  let effectiveLeverage: number;
  if (flashV2) {
    effectiveLeverage = requestedLeverage;
  } else {
    const userNotional = body.stakeUsdc * requestedLeverage;
    let clamped: number;
    try {
      clamped = await clampLeverageForNotional(position.market, userNotional);
    } catch (err) {
      const marketError = marketDataErrorResponse(err);
      if (marketError) return marketError;
      console.error("[bet/whale] leverage lookup failed:", err);
      return NextResponse.json(
        { error: "Could not load market data. Try again." },
        { status: 502 },
      );
    }
    effectiveLeverage = Math.min(requestedLeverage, clamped);
  }
  const finalNotional = body.stakeUsdc * effectiveLeverage;
  const sizingPrice = await resolveSizingPrice(position);
  if (!sizingPrice) {
    return NextResponse.json(
      { error: `Live price is unavailable for ${position.market}` },
      { status: 409 },
    );
  }
  const amountBase = lotSizedAmountFromNotional({
    notionalUsd: finalNotional,
    price: sizingPrice,
    lotSize: marketInfo.lot_size,
  });

  if (await hasOpenTailOnMarket(user.id, position.market, copyVenue)) {
    if (body.preflightOnly === true) {
      return NextResponse.json({
        phase: "preflight",
        canOpen: false,
        reason: "same_market_tail",
        error: `you already have an open ${position.market} tail - close it first`,
      });
    }
    return NextResponse.json(
      { error: `you already have an open ${position.market} tail - close it first` },
      { status: 409 },
    );
  }

  if (body.preflightOnly === true) {
    return NextResponse.json({
      phase: "preflight",
      canOpen: true,
      mode: detachedFromSource ? "snapshot" : "live",
      autoCloseOnSourceClose: sourceAutoClose,
    });
  }

  // Flash v2 whale tail: session-signed (one-tap), no agent wallet. The whole
  // Pacifica path below (agent onboarding, deposit top-up, pending/confirm
  // ledger + compensation) is skipped when the flag is on. We still hold a
  // tail reservation across the open to block a concurrent duplicate; an insert
  // failure after a successful open leaves the position visible as a self-directed
  // wallet row (recoverable), so no compensating close is needed.
  if (flashV2) {
    const reserved = await reserveTailOnMarket(user.id, position.market);
    if (!reserved) {
      return NextResponse.json(
        { error: `you already have an open ${position.market} tail - close it first` },
        { status: 409 },
      );
    }

    let result;
    try {
      result = await openCopyFlashV2({
        venue: flashV2,
        userId: user.id,
        owner: user.solanaPubkey,
        market: position.market,
        side: position.side,
        stakeUsdc: body.stakeUsdc,
        leverage: effectiveLeverage,
      });
    } catch (err) {
      await releaseReservationBestEffort(user.id, position.market);
      // An on-chain position already exists on this market (an orphan with no
      // bet row, or a self-directed position) — surface a clean conflict.
      if (err instanceof FlashV2PositionConflictError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      console.error("[bet/whale] flash-v2 open failed:", err);
      return NextResponse.json(
        { error: "Trade could not open. No funds were spent." },
        { status: 502 },
      );
    }

    if (result.kind === "enable-session") {
      await releaseReservationBestEffort(user.id, position.market);
      return NextResponse.json({ phase: "enable-session" });
    }
    if (result.kind === "onboard") {
      await releaseReservationBestEffort(user.id, position.market);
      return NextResponse.json({ phase: "onboard", steps: result.steps });
    }

    const avgFillPrice = position.currentMark ?? position.entryPrice;
    let bet: typeof bets.$inferSelect;
    try {
      [bet] = await db
        .insert(bets)
        .values({
          userId: user.id,
          type: "copy",
          amountUsdc: body.stakeUsdc,
          status: "confirmed",
          feeUsdc:
            result.quote.feeUsdUi != null && Number.isFinite(result.quote.feeUsdUi)
              ? result.quote.feeUsdUi
              : null,
          meta: buildWhaleCopyMeta({
            venue: "flash-v2",
            whaleId: whale.id,
            source: position.source,
            sourceAccount: position.sourceAccount,
            sourcePositionId: position.id,
            leaderMarket: position.market,
            leaderSide: position.side,
            leverage: effectiveLeverage,
            autoCloseOnSourceClose: sourceAutoClose,
            detachedFromSource,
            userEntryPrice: avgFillPrice,
            sourceEntryPriceAtCopy: position.entryPrice,
            pacificaOrderId: result.signature,
          }),
        })
        .returning();
      if (!bet) throw new Error("flash-v2 whale bet insert returned no row");
    } catch (err) {
      await releaseReservationBestEffort(user.id, position.market);
      console.error("[bet/whale] flash-v2 ledger insert failed:", err);
      return NextResponse.json(
        { error: "Could not record whale copy bet" },
        { status: 502 },
      );
    }

    await releaseReservationBestEffort(user.id, position.market);
    return NextResponse.json({
      phase: "open",
      betId: bet.id,
      txSig: result.signature,
      source: {
        whaleId: whale.id,
        displayName: whale.displayName,
        asset: position.market,
        side: position.side,
        leverage: effectiveLeverage,
        autoCloseOnSourceClose: sourceAutoClose,
        ...(detachedFromSource ? { detachedFromSource: true } : {}),
      },
    });
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
      { error: "Could not check your trading balance. Try again." },
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

  let pendingBet: typeof bets.$inferSelect;
  try {
    [pendingBet] = await db
      .insert(bets)
      .values({
        userId: user.id,
        type: "copy",
        amountUsdc: body.stakeUsdc,
        status: "pending",
        meta: buildWhaleCopyMeta({
          whaleId: whale.id,
          source: position.source,
          sourceAccount: position.sourceAccount,
          sourcePositionId: position.id,
          leaderMarket: position.market,
          leaderSide: position.side,
          leverage: effectiveLeverage,
          autoCloseOnSourceClose: sourceAutoClose,
          detachedFromSource,
          userEntryPrice: 0,
          sourceEntryPriceAtCopy: position.entryPrice,
          pacificaOrderId: "pending",
        }),
      })
      .returning();
    if (!pendingBet) {
      throw new Error("pending bet insert returned no row");
    }
  } catch (err) {
    await releaseReservationBestEffort(user.id, position.market);
    console.error("[bet/whale] pending ledger insert failed:", err);
    return NextResponse.json(
      { error: "Could not prepare whale copy bet" },
      { status: 502 },
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
    await markBetFailedBestEffort(pendingBet.id);
    await releaseReservationBestEffort(user.id, position.market);
    console.error("[bet/whale] open failed:", err);
    if (isPacificaFundingRateLimitError(err)) {
      return NextResponse.json(
        {
          error: "Trading venue is busy. Retrying shortly.",
          retryable: true,
          retryAfterMs:
            err instanceof PacificaFundingRateLimitError
              ? err.retryAfterMs
              : 5000,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Trade could not open. No funds were spent." },
      { status: 502 },
    );
  }

  let bet: typeof bets.$inferSelect;
  try {
    const avgFillPrice = Number(fill.avg_fill_price);
    [bet] = await db
      .update(bets)
      .set({
        status: "confirmed",
        feeUsdc: feeUsdcFromFill(fill),
        meta: buildWhaleCopyMeta({
          whaleId: whale.id,
          source: position.source,
          sourceAccount: position.sourceAccount,
          sourcePositionId: position.id,
          leaderMarket: position.market,
          leaderSide: position.side,
          leverage: effectiveLeverage,
          autoCloseOnSourceClose: sourceAutoClose,
          detachedFromSource,
          userEntryPrice: Number.isFinite(avgFillPrice)
            ? avgFillPrice
            : sizingPrice,
          sourceEntryPriceAtCopy: position.entryPrice,
          pacificaOrderId: fill.order_id ?? "unknown",
        }),
      })
      .where(eq(bets.id, pendingBet.id))
      .returning();
    if (!bet) {
      throw new Error("confirmed bet update returned no row");
    }
  } catch (err) {
    console.error("[bet/whale] ledger update failed:", err);
    try {
      await closeCopyOrder({
        agent,
        symbol: position.market,
        positionSide: position.side,
        amountBase,
      });
    } catch (closeErr) {
      console.error("[bet/whale] compensation close failed:", closeErr);
      await markBetManualReviewBestEffort(pendingBet.id);
      await blockReservationBestEffort(user.id, position.market);
      return NextResponse.json(
        {
          error:
            "Whale copy opened but could not be recorded or auto-closed. Manual review required.",
        },
        { status: 502 },
      );
    }
    await markBetFailedBestEffort(pendingBet.id);
    await releaseReservationBestEffort(user.id, position.market);
    return NextResponse.json(
      { error: "Could not confirm whale copy bet" },
      { status: 502 },
    );
  }

  await releaseReservationBestEffort(user.id, position.market);

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
      autoCloseOnSourceClose: sourceAutoClose,
      ...(detachedFromSource ? { detachedFromSource: true } : {}),
    },
  });
}
