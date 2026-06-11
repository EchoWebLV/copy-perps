import { NextResponse } from "next/server";
import { confirmFlashTailOpen } from "@/lib/bets/flash-tail";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  betId?: string;
  signature?: string;
  walletAddress?: string;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.betId || !body.signature) {
    return NextResponse.json(
      { error: "betId and signature required" },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  const ok = await confirmFlashTailOpen({
    betId: body.betId,
    userId: user.id,
    signature: body.signature,
  });
  if (!ok) {
    return NextResponse.json({ error: "bet not confirmable" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, betId: body.betId });
}
