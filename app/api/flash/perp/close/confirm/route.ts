import { NextResponse } from "next/server";
import { confirmFlashTailClose } from "@/lib/bets/flash-tail";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  betId?: string;
  signature?: string;
  receiveUsd?: number;
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
  const ok = await confirmFlashTailClose({
    betId: body.betId,
    userId: user.id,
    signature: body.signature,
    receiveUsdEstimate:
      typeof body.receiveUsd === "number" && Number.isFinite(body.receiveUsd)
        ? body.receiveUsd
        : null,
  });
  if (!ok) {
    return NextResponse.json({ error: "bet not closable" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, betId: body.betId });
}
