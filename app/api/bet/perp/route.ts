import { NextResponse } from "next/server";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { db } from "@/lib/db";
import { bets } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { legacyRailsEnabled } from "@/lib/features";
import { ensureUser } from "@/lib/users/ensure";
import { flashSymbolFor } from "@/lib/flash-trade/client";
import { buildOpenPerpTx, readPerpPosition } from "@/lib/flash-trade/perp";
import {
  ensureUsdcOrConsolidate,
  ensureUsdcOrConsolidateGasless,
  InsufficientCombinedBalanceError,
  requireSolForBet,
  InsufficientSolForFeesError,
} from "@/lib/usd/consolidate";
import {
  buildUserSolDripIx,
  ensureGasWalletReady,
  getGasWalletPubkey,
  partialSignAsFeePayer,
  GasWalletExhaustedError,
} from "@/lib/wallets/gas";
import { buildFeeTransferInstructions } from "@/lib/wallets/treasury";
import { computeBetFee } from "@/lib/fees/calc";
import type { WhaleSignal } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MIN_USDC = 5;
const MAX_USDC = 1000;

export async function POST(request: Request) {
  if (!legacyRailsEnabled()) {
    return NextResponse.json(
      { error: "legacy rail disabled" },
      { status: 410 },
    );
  }

  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    signal?: WhaleSignal;
    action?: "tail" | "fade";
    amountUsdc?: number;
    walletAddress?: string;
  } | null;

  if (
    !body?.signal ||
    body.signal.type !== "whale" ||
    !body.signal.asset ||
    (body.action !== "tail" && body.action !== "fade") ||
    typeof body.amountUsdc !== "number"
  ) {
    return NextResponse.json(
      { error: "signal (whale), action (tail|fade), amountUsdc required" },
      { status: 400 },
    );
  }

  if (body.amountUsdc < MIN_USDC || body.amountUsdc > MAX_USDC) {
    return NextResponse.json(
      { error: `amount must be between $${MIN_USDC} and $${MAX_USDC}` },
      { status: 400 },
    );
  }

  const whale: WhaleSignal = body.signal;
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

  // Flash position PDAs are unique per (user, market, side). Calling
  // swapAndOpen when one already exists fails on chain with confusing
  // errors (AccountNotInitialized 0xbc4 or InvalidArgument depending on
  // state). Reject early — the user should close before re-opening on
  // the same asset+side.
  try {
    const existing = await readPerpPosition(
      new PublicKey(user.solanaPubkey),
      flashSymbol,
      direction,
    );
    if (existing) {
      return NextResponse.json(
        {
          error: `You already have an open ${flashSymbol} ${direction} position. Close it from Portfolio before opening another.`,
        },
        { status: 409 },
      );
    }
  } catch (err) {
    // Non-fatal — if the precheck itself errors, fall through to the
    // build path and let on-chain simulation surface the real issue.
    console.warn("[bet/perp] position precheck failed:", err);
  }

  const gasless = process.env.FEATURE_GASLESS_BETS === "true";

  if (gasless) {
    try {
      await ensureGasWalletReady();
    } catch (err) {
      if (err instanceof GasWalletExhaustedError) {
        return NextResponse.json({ error: err.message }, { status: 503 });
      }
      throw err;
    }

    const fee = computeBetFee(body.amountUsdc);
    const requiredUsd = body.amountUsdc + fee.totalFeeUsdc;

    try {
      const consolidation = await ensureUsdcOrConsolidateGasless({
        userPubkey: user.solanaPubkey,
        requiredUsd,
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
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      console.error("[bet/perp] consolidation check failed:", err);
      return NextResponse.json(
        { error: `Balance check failed: ${String(err)}` },
        { status: 502 },
      );
    }

    const userPk = new PublicKey(user.solanaPubkey);
    const feeIxs = buildFeeTransferInstructions({
      userPubkey: userPk,
      feeUsdcDollars: fee.totalFeeUsdc,
      feePayerForAta: getGasWalletPubkey(),
    });

    // Flash's swapAndOpen creates ATAs inline (collateral USDC ATA at
    // minimum, sometimes more) with the user as funder. Prepend a SOL
    // drip sized for ~2 ATAs so the in-tx state has lamports for rent
    // before Flash's create-ATA ix runs. Conservative — over-drip is
    // residual that stays in user's wallet for future bets.
    const dripIx = buildUserSolDripIx({
      userPubkey: userPk,
      numAtasToFund: 2,
    });

    let openResult;
    try {
      openResult = await buildOpenPerpTx({
        userPubkey: userPk,
        asset: flashSymbol,
        marketIndex,
        direction,
        marginUsdc: body.amountUsdc,
        whaleLeverage: whale.leverage,
        gaslessFeePayer: getGasWalletPubkey(),
        prependInstructions: dripIx ? [dripIx] : [],
        appendInstructions: feeIxs,
      });
    } catch (err) {
      console.error("[bet/perp] build failed:", err);
      return NextResponse.json(
        { error: `Flash Trade tx build failed: ${String(err)}` },
        { status: 502 },
      );
    }

    // Round-trip the tx through deserialize → partial-sign → serialize so
    // the Gas Wallet's signature is on the wire alongside any ephemeral
    // signers Flash already added.
    const txBytes = Buffer.from(openResult.transaction, "base64");
    const v0Tx = VersionedTransaction.deserialize(txBytes);
    partialSignAsFeePayer(v0Tx);
    const signedTxB64 = Buffer.from(v0Tx.serialize()).toString("base64");

    const [bet] = await db
      .insert(bets)
      .values({
        userId: user.id,
        type: "perp",
        amountUsdc: body.amountUsdc,
        feeUsdc: fee.totalFeeUsdc,
        status: "pending",
        meta: {
          signalId: whale.id,
          venue: "FlashTrade",
          flashAsset: flashSymbol,
          whaleAddress: whale.walletAddress,
          whaleAsset: whale.asset,
          whaleSide: whale.side,
          whaleLeverage: whale.leverage,
          action: body.action,
          direction,
          marketIndex,
          baseAssetAmount: openResult.baseAssetAmount,
          notionalUsd: openResult.notionalUsd,
        },
      })
      .returning();

    return NextResponse.json({
      phase: "open",
      betId: bet.id,
      swapTransaction: signedTxB64,
      notionalUsd: openResult.notionalUsd,
      direction: openResult.direction,
      isFirstTimeUser: openResult.isFirstTimeUser,
    });
  }

  // --- legacy path (FEATURE_GASLESS_BETS != "true") ---

  // SOL preflight — Flash's swapAndOpen allocates ATAs and a position
  // account inline; without ~0.01 SOL the tx fails with cryptic
  // "insufficient lamports" deep in simulation logs. Catch it here.
  try {
    await requireSolForBet(user.solanaPubkey);
  } catch (err) {
    if (err instanceof InsufficientSolForFeesError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
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
    return NextResponse.json(
      { error: `Balance check failed: ${String(err)}` },
      { status: 502 },
    );
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
      type: "perp",
      amountUsdc: body.amountUsdc,
      status: "pending",
      meta: {
        signalId: whale.id,
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
