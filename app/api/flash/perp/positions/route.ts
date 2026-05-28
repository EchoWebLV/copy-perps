import { NextResponse } from "next/server";
import {
  FlashPerpsError,
  getFlashPerpsService,
} from "@/lib/flash/perps";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface Body {
  walletAddress?: string;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.walletAddress) {
    return NextResponse.json({ error: "walletAddress required" }, { status: 400 });
  }

  const user = await ensureUser(claims.userId, body.walletAddress);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  try {
    const positions = await getFlashPerpsService().positionsOf(user.solanaPubkey);
    return NextResponse.json({ positions });
  } catch (err) {
    if (err instanceof FlashPerpsError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("[flash/perp/positions] request failed:", err);
    return NextResponse.json(
      { error: "Could not load Flash positions. Try again." },
      { status: 502 },
    );
  }
}
