import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { db } from "@/lib/db";
import { bets, users } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { buildClosePerpTx } from "@/lib/flash-trade/perp";
import {
  ensureGasWalletReady,
  gasWalletPubkey,
  partialSignAsFeePayer,
  GasWalletExhaustedError,
} from "@/lib/wallets/gas";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

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
  const flashAsset = meta.flashAsset as string | undefined;
  const direction = meta.direction as "long" | "short" | undefined;
  // Old Drift bets won't have flashAsset on meta — they were opened on a
  // protocol that's no longer wired up. Reject with a clear message.
  if (!flashAsset || (direction !== "long" && direction !== "short")) {
    return NextResponse.json(
      { error: "bet was opened on a different venue and can't be closed here" },
      { status: 400 },
    );
  }

  const gasless = process.env.FEATURE_GASLESS_BETS === "true";

  try {
    if (gasless) {
      try {
        await ensureGasWalletReady();
      } catch (err) {
        if (err instanceof GasWalletExhaustedError) {
          return NextResponse.json({ error: err.message }, { status: 503 });
        }
        throw err;
      }

      const result = await buildClosePerpTx({
        userPubkey: new PublicKey(user.solanaPubkey),
        asset: flashAsset,
        side: direction,
        gaslessFeePayer: gasWalletPubkey,
      });
      const txBytes = Buffer.from(result.transaction, "base64");
      const v0Tx = VersionedTransaction.deserialize(txBytes);
      partialSignAsFeePayer(v0Tx);
      return NextResponse.json({
        swapTransaction: Buffer.from(v0Tx.serialize()).toString("base64"),
        expectedProceedsAtomic: Math.floor(
          (bet.amountUsdc + result.expectedProceedsUsd) * 1_000_000,
        ).toString(),
      });
    }

    const result = await buildClosePerpTx({
      userPubkey: new PublicKey(user.solanaPubkey),
      asset: flashAsset,
      side: direction,
    });
    return NextResponse.json({
      swapTransaction: result.transaction,
      expectedProceedsAtomic: Math.floor(
        (bet.amountUsdc + result.expectedProceedsUsd) * 1_000_000,
      ).toString(),
    });
  } catch (err) {
    console.error("[bet/perp/close] failed:", err);
    return NextResponse.json(
      { error: `Close build failed: ${String(err)}` },
      { status: 502 },
    );
  }
}
