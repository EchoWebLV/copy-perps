import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { PublicKey } from "@solana/web3.js";
import { db } from "@/lib/db";
import { signals, bets } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { flashSymbolFor } from "@/lib/flash-trade/client";
import { buildOpenPerpTx } from "@/lib/flash-trade/perp";
import {
  ensureUsdcOrConsolidate,
  InsufficientCombinedBalanceError,
} from "@/lib/usd/consolidate";
import type { WhaleSignal } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MIN_USDC = 5;
const MAX_USDC = 1000;

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    signalId?: string;
    action?: "tail" | "fade";
    amountUsdc?: number;
    walletAddress?: string;
  } | null;

  if (
    !body?.signalId ||
    (body.action !== "tail" && body.action !== "fade") ||
    typeof body.amountUsdc !== "number"
  ) {
    return NextResponse.json(
      { error: "signalId, action (tail|fade), amountUsdc required" },
      { status: 400 },
    );
  }

  if (body.amountUsdc < MIN_USDC || body.amountUsdc > MAX_USDC) {
    return NextResponse.json(
      { error: `amount must be between $${MIN_USDC} and $${MAX_USDC}` },
      { status: 400 },
    );
  }

  const [signalRow] = await db
    .select()
    .from(signals)
    .where(eq(signals.id, body.signalId))
    .limit(1);

  if (!signalRow || signalRow.type !== "whale") {
    return NextResponse.json(
      { error: "signal not found or wrong type" },
      { status: 400 },
    );
  }

  const whale = signalRow.payload as WhaleSignal;
  const flashSymbol = flashSymbolFor(whale.asset);
  if (flashSymbol == null) {
    return NextResponse.json(
      { error: `${whale.asset} not yet supported on Flash Trade (MVP: SOL/BTC/ETH only)` },
      { status: 400 },
    );
  }
  // Synthetic index for compatibility with existing meta shape; Flash
  // doesn't use indexes (it uses symbols).
  const marketIndex = ["SOL", "BTC", "ETH"].indexOf(flashSymbol);

  const direction: "long" | "short" =
    body.action === "tail"
      ? whale.side
      : whale.side === "long"
        ? "short"
        : "long";

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  if (!user.solanaPubkey) {
    return NextResponse.json(
      { error: "no Solana wallet on user" },
      { status: 400 },
    );
  }

  // Flash Trade collateral is USDC-only. If the user is holding their
  // funds in jupUSD (common after prediction closes settle), build a
  // jupUSD->USDC swap first and ask the client to sign it before we
  // can build the actual perp open.
  try {
    const consolidation = await ensureUsdcOrConsolidate({
      userPubkey: user.solanaPubkey,
      requiredUsd: body.amountUsdc,
    });
    if (!consolidation.ready) {
      return NextResponse.json({
        phase: "consolidate",
        consolidationTransaction: consolidation.consolidationTransaction,
        usdcBalance: consolidation.usdcBalance,
        jupUsdBalance: consolidation.jupUsdBalance,
        requiredUsd: consolidation.requiredUsd,
      });
    }
  } catch (err) {
    if (err instanceof InsufficientCombinedBalanceError) {
      return NextResponse.json(
        { error: err.message },
        { status: 400 },
      );
    }
    console.error("[bet/perp] consolidation check failed:", err);
    // Fall through and let the Flash SDK surface its own error.
  }

  let tx;
  try {
    tx = await buildOpenPerpTx({
      userPubkey: new PublicKey(user.solanaPubkey),
      asset: flashSymbol,
      marketIndex,
      direction,
      marginUsdc: body.amountUsdc,
      whaleLeverage: whale.leverage,
    });
  } catch (err) {
    console.error("[bet/perp] build failed:", err);
    return NextResponse.json(
      { error: `Flash Trade tx build failed: ${String(err)}` },
      { status: 502 },
    );
  }

  const [bet] = await db
    .insert(bets)
    .values({
      userId: user.id,
      signalId: signalRow.id,
      type: "perp",
      amountUsdc: body.amountUsdc,
      status: "pending",
      meta: {
        venue: "FlashTrade",
        flashAsset: flashSymbol,
        whaleAddress: whale.walletAddress,
        whaleAsset: whale.asset,
        whaleSide: whale.side,
        whaleLeverage: whale.leverage,
        action: body.action,
        direction,
        marketIndex,
        baseAssetAmount: tx.baseAssetAmount,
        notionalUsd: tx.notionalUsd,
      },
    })
    .returning();

  return NextResponse.json({
    phase: "open",
    betId: bet.id,
    swapTransaction: tx.transaction,
    notionalUsd: tx.notionalUsd,
    direction: tx.direction,
    isFirstTimeUser: tx.isFirstTimeUser,
  });
}
