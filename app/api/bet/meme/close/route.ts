import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, users } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { sellTokenForUsdc } from "@/lib/jupiter/swap";

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
  const tokenAddress = meta.tokenAddress as string | undefined;
  const tokenAmount = (meta.actualOutAmount ?? meta.expectedOutAmount) as
    | string
    | undefined;
  if (!tokenAddress || !tokenAmount) {
    return NextResponse.json(
      { error: "bet missing token data" },
      { status: 400 },
    );
  }

  try {
    const result = await sellTokenForUsdc({
      inputMint: tokenAddress,
      tokenAmountAtomic: BigInt(tokenAmount),
      userPublicKey: user.solanaPubkey,
    });
    return NextResponse.json({
      swapTransaction: result.swap.swapTransaction,
      expectedUsdcOut: result.quote.outAmount,
    });
  } catch (err) {
    console.error("[bet/meme/close] Jupiter failed:", err);
    return NextResponse.json(
      { error: `Jupiter sell quote failed: ${String(err)}` },
      { status: 502 },
    );
  }
}
