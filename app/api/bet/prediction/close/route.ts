import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { PublicKey } from "@solana/web3.js";
import { db } from "@/lib/db";
import { bets, users } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { closePosition, getPosition } from "@/lib/jupiter-prediction/client";
import {
  buildPredictionPrefundTx,
  ensureGasWalletReady,
  GasWalletExhaustedError,
} from "@/lib/wallets/gas";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";
// Jupiter Prediction's close endpoint geofences egress IPs the same way
// the open endpoint does. Pin to Frankfurt — see /api/bet/prediction.
export const preferredRegion = "fra1";

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    betId?: string;
  } | null;
  if (!body?.betId) {
    return NextResponse.json({ error: "betId required" }, { status: 400 });
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.privyId, claims.userId))
    .limit(1);
  if (!user?.solanaPubkey) {
    return NextResponse.json({ error: "no wallet" }, { status: 400 });
  }

  const [bet] = await db
    .select()
    .from(bets)
    .where(and(eq(bets.id, body.betId), eq(bets.userId, user.id)))
    .limit(1);
  if (!bet || bet.status !== "confirmed" || bet.closedAt) {
    return NextResponse.json(
      { error: "bet not closeable" },
      { status: 400 },
    );
  }

  const meta = (bet.meta ?? {}) as Record<string, unknown>;
  const positionPubkey = meta.positionPubkey as string | undefined;
  if (!positionPubkey) {
    return NextResponse.json(
      { error: "bet missing positionPubkey" },
      { status: 400 },
    );
  }

  const gasless = process.env.FEATURE_GASLESS_BETS === "true";

  try {
    // Read position mark-to-market BEFORE building the close. Jupiter's
    // close response sets `orderCostUsd` to the user's spend on the order
    // (zero for sells), which made every closed prediction record proceeds
    // of $0 and display as -100% PnL. The position's `valueUsd` is the
    // current micro-USD value the user gets back at market price — much
    // better proceeds proxy. Falls back to orderCostUsd if the market has
    // already resolved (valueUsd is null in that case).
    const position = await getPosition(positionPubkey).catch(() => null);
    const result = await closePosition(positionPubkey, user.solanaPubkey);
    if (!result.transaction) {
      return NextResponse.json(
        { error: "Close returned no transaction" },
        { status: 502 },
      );
    }
    const expectedProceedsAtomic =
      position?.valueUsd ?? result.order.orderCostUsd;

    if (gasless) {
      try {
        await ensureGasWalletReady();
      } catch (err) {
        if (err instanceof GasWalletExhaustedError) {
          return NextResponse.json({ error: err.message }, { status: 503 });
        }
        throw err;
      }
      // Closes don't carry a platform fee; the prefund tx (if needed) is
      // a pure SOL drip so the user's untouched Jupiter Prediction tx
      // can pay its own fee.
      const prefundB64 = await buildPredictionPrefundTx({
        userPubkey: new PublicKey(user.solanaPubkey),
        appendInstructions: [],
      });
      return NextResponse.json({
        prefundTransaction: prefundB64,
        swapTransaction: result.transaction,
        expectedProceedsAtomic,
      });
    }

    return NextResponse.json({
      swapTransaction: result.transaction,
      expectedProceedsAtomic,
    });
  } catch (err) {
    console.error("[bet/prediction/close] failed:", err);
    return NextResponse.json(
      { error: `Close build failed: ${String(err)}` },
      { status: 502 },
    );
  }
}
