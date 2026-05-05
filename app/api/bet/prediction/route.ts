import { NextResponse } from "next/server";
import {
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { db } from "@/lib/db";
import { bets } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { getConnection } from "@/lib/solana/balance";
import { createOrder } from "@/lib/jupiter-prediction/client";
import {
  ensureUsdcOrConsolidate,
  ensureUsdcOrConsolidateGasless,
  InsufficientCombinedBalanceError,
  requireSolForBet,
  InsufficientSolForFeesError,
} from "@/lib/usd/consolidate";
import {
  ensureGasWalletReady,
  gasWalletKeypair,
  gasWalletPubkey,
  partialSignAsFeePayer,
  GasWalletExhaustedError,
} from "@/lib/wallets/gas";
import { buildFeeTransferInstructions } from "@/lib/wallets/treasury";
import { computeBetFee } from "@/lib/fees/calc";
import type { PredictionSignal, MultiPredictionSignal } from "@/lib/types";

// Jupiter Prediction's /orders endpoint server-side checks user SOL
// before building. Below this floor it returns 400 INSUFFICIENT_FUNDS
// even if we'd cover the user's actual on-chain costs in a follow-up
// tx. The user pays for: tx fee (~5k) + position PDA rent (~3M) +
// their order-pubkey PDA rent (~2M) + jupUSD ATA if any (~2M) + slack.
// We over-provision so Jupiter's pre-flight always sees enough.
const PREDICTION_USER_SOL_FLOOR_LAMPORTS = 15_000_000; // 0.015 SOL ≈ $2.40

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MIN_USDC = 5;
const MAX_USDC = 1000;
// Jupiter Prediction's "Minimum order is $5" check runs against contract
// value AFTER fees, so a $5 deposit is rejected. Pad small deposits up
// to this floor so a user-facing $5 stake actually clears the API.
const PREDICTION_DEPOSIT_FLOOR = 5.5;

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    signal?: PredictionSignal | MultiPredictionSignal;
    outcome?: "yes" | "no";
    amountUsdc?: number;
    walletAddress?: string;
    marketId?: string;
    outcomeLabel?: string;
  } | null;

  if (
    !body?.signal ||
    (body.signal.type !== "prediction" && body.signal.type !== "multiprediction") ||
    (body.outcome !== "yes" && body.outcome !== "no") ||
    typeof body.amountUsdc !== "number"
  ) {
    return NextResponse.json(
      { error: "signal (prediction|multiprediction), outcome (yes|no), amountUsdc required" },
      { status: 400 },
    );
  }

  if (body.amountUsdc < MIN_USDC || body.amountUsdc > MAX_USDC) {
    return NextResponse.json(
      { error: `amount must be between $${MIN_USDC} and $${MAX_USDC}` },
      { status: 400 },
    );
  }

  const signal = body.signal;

  // Resolve marketId + outcome label, branching on signal flavor.
  let resolvedMarketId: string;
  let resolvedOutcomeLabel: string | undefined;
  let resolvedQuestion: string;
  let entryYesProbability: number | undefined;
  let resolvedEventId: string | undefined;

  if (signal.type === "prediction") {
    const p: PredictionSignal = signal;
    if (!p.marketId) {
      return NextResponse.json(
        { error: "signal missing marketId" },
        { status: 400 },
      );
    }
    resolvedMarketId = p.marketId;
    resolvedQuestion = p.question;
    entryYesProbability = p.yesProbability;
    resolvedEventId = p.eventId;
  } else {
    const p: MultiPredictionSignal = signal;
    if (!body.marketId) {
      return NextResponse.json(
        { error: "marketId required for multi-outcome events" },
        { status: 400 },
      );
    }
    const outcome = p.outcomes.find((o) => o.marketId === body.marketId);
    if (!outcome) {
      return NextResponse.json(
        { error: "marketId not in signal outcomes" },
        { status: 400 },
      );
    }
    resolvedMarketId = outcome.marketId;
    resolvedOutcomeLabel = body.outcomeLabel ?? outcome.label;
    resolvedQuestion = `${outcome.label} · ${p.question}`;
    entryYesProbability = outcome.yesProbability;
    resolvedEventId = p.eventId;
  }

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  if (!user.solanaPubkey) {
    return NextResponse.json(
      { error: "no Solana wallet on user" },
      { status: 400 },
    );
  }

  const isYes = body.outcome === "yes";
  // Pad up to the API's effective minimum if the user's stake would
  // otherwise be rejected. The bet record's amountUsdc reflects the
  // padded value so PnL math stays consistent.
  const effectiveAmount = Math.max(body.amountUsdc, PREDICTION_DEPOSIT_FLOOR);
  const depositAtomic = BigInt(Math.floor(effectiveAmount * 1_000_000));

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

    const fee = computeBetFee(effectiveAmount);
    const requiredUsd = effectiveAmount + fee.totalFeeUsdc;

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
      console.error("[bet/prediction] consolidation check failed:", err);
      return NextResponse.json(
        { error: `Balance check failed: ${String(err)}` },
        { status: 502 },
      );
    }

    // Jupiter Prediction's API checks user SOL server-side BEFORE
    // building the order tx, so we can't drip inside the order. Land a
    // gas-wallet-only drip on chain first.
    const conn = getConnection();
    const userPk = new PublicKey(user.solanaPubkey);
    const userLamportsBefore = await conn.getBalance(userPk, "confirmed");
    console.log(
      `[bet/prediction gasless] user lamports=${userLamportsBefore}, floor=${PREDICTION_USER_SOL_FLOOR_LAMPORTS}`,
    );
    if (userLamportsBefore < PREDICTION_USER_SOL_FLOOR_LAMPORTS) {
      const dripLamports =
        PREDICTION_USER_SOL_FLOOR_LAMPORTS - userLamportsBefore;
      console.log(`[bet/prediction gasless] dripping ${dripLamports} lamports`);
      const { blockhash } = await conn.getLatestBlockhash("confirmed");
      const dripMessage = new TransactionMessage({
        payerKey: gasWalletPubkey,
        recentBlockhash: blockhash,
        instructions: [
          SystemProgram.transfer({
            fromPubkey: gasWalletPubkey,
            toPubkey: userPk,
            lamports: dripLamports,
          }),
        ],
      }).compileToV0Message();
      const dripTx = new VersionedTransaction(dripMessage);
      dripTx.sign([gasWalletKeypair]);
      try {
        const sig = await conn.sendRawTransaction(dripTx.serialize(), {
          skipPreflight: false,
        });
        // Use "finalized" not just "confirmed" — Jupiter's RPC may lag
        // behind ours on confirmed slots and still see the old balance.
        const result = await conn.confirmTransaction(sig, "finalized");
        if (result.value.err) {
          throw new Error(
            `drip failed on chain: ${JSON.stringify(result.value.err)}`,
          );
        }
        // Extra propagation buffer.
        await new Promise((r) => setTimeout(r, 3000));
        const userLamportsAfter = await conn.getBalance(userPk, "confirmed");
        console.log(
          `[bet/prediction gasless] drip landed sig=${sig} userLamportsAfter=${userLamportsAfter}`,
        );
      } catch (err) {
        console.error("[bet/prediction] server-side drip failed:", err);
        return NextResponse.json(
          { error: `SOL drip failed: ${String(err)}` },
          { status: 502 },
        );
      }
    }

    let order;
    try {
      order = await createOrder({
        ownerPubkey: user.solanaPubkey,
        marketId: resolvedMarketId,
        isYes,
        isBuy: true,
        depositAmountMicroUsd: depositAtomic,
      });
    } catch (err) {
      console.error("[bet/prediction] order failed:", err);
      return NextResponse.json(
        { error: `Order build failed: ${String(err)}` },
        { status: 502 },
      );
    }

    if (!order.transaction) {
      return NextResponse.json(
        { error: "Order build returned no transaction" },
        { status: 502 },
      );
    }

    // Build a separate fee-transfer tx that the client signs+submits
    // alongside the order. Gas Wallet pays the SOL fee on this tx; the
    // user signs to authorize the USDC transfer.
    const feeIxs = buildFeeTransferInstructions({
      userPubkey: userPk,
      feeUsdcDollars: fee.totalFeeUsdc,
      feePayerForAta: gasWalletPubkey,
    });
    const { blockhash: feeBlockhash } = await conn.getLatestBlockhash("confirmed");
    const feeMessage = new TransactionMessage({
      payerKey: gasWalletPubkey,
      recentBlockhash: feeBlockhash,
      instructions: feeIxs,
    }).compileToV0Message();
    const feeTx = new VersionedTransaction(feeMessage);
    partialSignAsFeePayer(feeTx);

    const [bet] = await db
      .insert(bets)
      .values({
        userId: user.id,
        type: "prediction",
        amountUsdc: effectiveAmount,
        feeUsdc: fee.totalFeeUsdc,
        status: "pending",
        meta: {
          signalId: body.signal.id,
          marketId: resolvedMarketId,
          eventId: resolvedEventId,
          outcome: body.outcome,
          outcomeLabel: resolvedOutcomeLabel,
          question: resolvedQuestion,
          entryYesProbability,
          contracts: order.order.contracts,
          avgPriceUsd: order.order.newAvgPriceUsd,
          orderCostUsd: order.order.orderCostUsd,
          positionPubkey: order.order.positionPubkey,
        },
      })
      .returning();

    return NextResponse.json({
      phase: "open",
      betId: bet.id,
      feeTransferTransaction: Buffer.from(feeTx.serialize()).toString("base64"),
      swapTransaction: order.transaction,
      contracts: order.order.contracts,
      avgPriceUsd: order.order.newAvgPriceUsd,
    });
  }

  // --- legacy path (FEATURE_GASLESS_BETS != "true") ---

  // SOL preflight — Jupiter Prediction's createOrder allocates ATAs
  // for the position; without ~0.01 SOL the API returns "Insufficient
  // SOL or token balance" which obscures whether the user is short on
  // USDC or just short on SOL for fees.
  try {
    await requireSolForBet(user.solanaPubkey);
  } catch (err) {
    if (err instanceof InsufficientSolForFeesError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  // Unify on USDC across all bet paths. If the user is short USDC but
  // their combined USDC + jupUSD covers the trade, ask them to sign a
  // jupUSD->USDC swap first; the client re-calls this endpoint after
  // consolidation confirms.
  try {
    const consolidation = await ensureUsdcOrConsolidate({
      userPubkey: user.solanaPubkey,
      requiredUsd: effectiveAmount,
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
    console.error("[bet/prediction] consolidation check failed:", err);
    return NextResponse.json(
      { error: `Balance check failed: ${String(err)}` },
      { status: 502 },
    );
  }

  let order;
  try {
    order = await createOrder({
      ownerPubkey: user.solanaPubkey,
      marketId: resolvedMarketId,
      isYes,
      isBuy: true,
      depositAmountMicroUsd: depositAtomic,
    });
  } catch (err) {
    console.error("[bet/prediction] order failed:", err);
    return NextResponse.json(
      { error: `Order build failed: ${String(err)}` },
      { status: 502 },
    );
  }

  if (!order.transaction) {
    return NextResponse.json(
      { error: "Order build returned no transaction" },
      { status: 502 },
    );
  }

  const [bet] = await db
    .insert(bets)
    .values({
      userId: user.id,
      type: "prediction",
      amountUsdc: effectiveAmount,
      status: "pending",
      meta: {
        signalId: body.signal.id,
        marketId: resolvedMarketId,
        eventId: resolvedEventId,
        outcome: body.outcome,
        outcomeLabel: resolvedOutcomeLabel,
        question: resolvedQuestion,
        entryYesProbability,
        contracts: order.order.contracts,
        avgPriceUsd: order.order.newAvgPriceUsd,
        orderCostUsd: order.order.orderCostUsd,
        positionPubkey: order.order.positionPubkey,
      },
    })
    .returning();

  return NextResponse.json({
    phase: "open",
    betId: bet.id,
    swapTransaction: order.transaction,
    contracts: order.order.contracts,
    avgPriceUsd: order.order.newAvgPriceUsd,
  });
}
