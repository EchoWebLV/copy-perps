import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { PublicKey } from "@solana/web3.js";
import { db } from "@/lib/db";
import { bets, users } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { buildClosePerpTx } from "@/lib/drift/perp";

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
  const marketIndex = meta.marketIndex as number | undefined;
  if (typeof marketIndex !== "number") {
    return NextResponse.json(
      { error: "bet missing marketIndex" },
      { status: 400 },
    );
  }

  try {
    const result = await buildClosePerpTx({
      userPubkey: new PublicKey(user.solanaPubkey),
      marketIndex,
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
